import { buildDashboardContextKey } from './dashboardFetch';

function formatSafeExpensesError(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : '';
  if (/access denied/i.test(msg)) {
    return 'Access denied while loading expenses. Please verify your branch permissions.';
  }
  return fallback;
}

export function buildExpensesContextKey(
  userId: string | null | undefined,
  businessId: string | null | undefined,
  selectedBranchId: string | null | undefined,
  isSalaryAuthorized: boolean
): string | null {
  return buildDashboardContextKey(userId, businessId, selectedBranchId, isSalaryAuthorized);
}

export function formatSafeReconcileError(err: unknown): string {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err !== null && 'message' in err && typeof (err as { message?: unknown }).message === 'string'
        ? (err as { message: string }).message
        : '';

  if (/access denied|not authorized|permission denied|insufficient_privilege/i.test(msg)) {
    return 'Access denied: you are not authorized to reconcile salary expenses.';
  }
  if (/already linked/i.test(msg)) {
    return 'This teacher payment is already linked to another salary expense.';
  }
  if (/branch mismatch/i.test(msg)) {
    return 'Selected teacher payment belongs to a different branch.';
  }
  return 'Unable to save salary expense classification. Please try again.';
}

export interface ExpensesFetchCallbacks<TExpense, TUnresolved> {
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setLoadedContextKey: (contextKey: string | null) => void;
  setExpenses: (expenses: TExpense[]) => void;
  setUnresolvedSalaryExpenses: (items: TUnresolved[]) => void;
}

export interface ExecuteExpensesFetchParams<TExpense, TUnresolved> {
  seqRef: { current: number };
  userId: string | null | undefined;
  businessId: string | null | undefined;
  selectedBranchId: string | null | undefined;
  isSalaryAuthorized: boolean;
  callbacks: ExpensesFetchCallbacks<TExpense, TUnresolved>;
  loadExpenses: () => Promise<{
    expenses: TExpense[];
    unresolvedSalaryExpenses: TUnresolved[];
  }>;
}

export async function executeExpensesFetch<TExpense, TUnresolved>({
  seqRef,
  userId,
  businessId,
  selectedBranchId,
  isSalaryAuthorized,
  callbacks,
  loadExpenses,
}: ExecuteExpensesFetchParams<TExpense, TUnresolved>): Promise<void> {
  const requestSeq = ++seqRef.current;

  if (!userId || !businessId) {
    callbacks.setExpenses([]);
    callbacks.setUnresolvedSalaryExpenses([]);
    callbacks.setLoadedContextKey(null);
    callbacks.setError(null);
    callbacks.setLoading(false);
    return;
  }

  const requestContextKey = buildExpensesContextKey(
    userId,
    businessId,
    selectedBranchId,
    isSalaryAuthorized
  );

  callbacks.setLoading(true);
  callbacks.setError(null);
  callbacks.setLoadedContextKey(null);
  callbacks.setExpenses([]);
  callbacks.setUnresolvedSalaryExpenses([]);

  try {
    const result = await loadExpenses();
    if (seqRef.current !== requestSeq) {
      return;
    }
    callbacks.setExpenses(result.expenses);
    callbacks.setUnresolvedSalaryExpenses(result.unresolvedSalaryExpenses);
    callbacks.setLoadedContextKey(requestContextKey);
    callbacks.setError(null);
  } catch (err) {
    if (seqRef.current !== requestSeq) {
      return;
    }
    callbacks.setExpenses([]);
    callbacks.setUnresolvedSalaryExpenses([]);
    callbacks.setLoadedContextKey(null);
    callbacks.setError(
      formatSafeExpensesError(err, 'Unable to load expenses right now. Please try again.')
    );
  } finally {
    if (seqRef.current === requestSeq) {
      callbacks.setLoading(false);
    }
  }
}

export interface ReconcilePaymentOptionsCallbacks<TOption> {
  setLoadingOptions?: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setOptions: (options: TOption[]) => void;
}

export interface ExecuteReconcilePaymentOptionsParams<TOption> {
  seqRef: { current: number };
  expenseId: string | null | undefined;
  callbacks: ReconcilePaymentOptionsCallbacks<TOption>;
  loadOptions: () => Promise<TOption[]>;
}

export async function executeReconcilePaymentOptionsFetch<TOption>({
  seqRef,
  expenseId,
  callbacks,
  loadOptions,
}: ExecuteReconcilePaymentOptionsParams<TOption>): Promise<void> {
  const requestSeq = ++seqRef.current;
  callbacks.setLoadingOptions?.(true);
  callbacks.setError(null);
  callbacks.setOptions([]);

  if (!expenseId) {
    callbacks.setLoadingOptions?.(false);
    return;
  }

  try {
    const rows = await loadOptions();
    if (seqRef.current !== requestSeq) {
      return;
    }
    callbacks.setOptions(rows);
    callbacks.setError(null);
  } catch (err) {
    if (seqRef.current !== requestSeq) {
      return;
    }
    callbacks.setOptions([]);
    callbacks.setError(
      formatSafeExpensesError(err, 'Unable to load teacher payment records.')
    );
  } finally {
    if (seqRef.current === requestSeq) {
      callbacks.setLoadingOptions?.(false);
    }
  }
}

export interface ExecuteReconcileSaveParams {
  isSalaryAuthorized: boolean;
  userId: string | null | undefined;
  businessId: string | null | undefined;
  selectedExpenseId: string | null | undefined;
  reconcileAction: 'linked_duplicate' | 'standalone' | 'unresolved';
  selectedStaffPaymentId: string;
  callbacks: {
    setSubmitting: (submitting: boolean) => void;
    setError: (error: string | null) => void;
    setConfirming: (confirming: boolean) => void;
    setModalOpen: (open: boolean) => void;
    clearSelectedExpense: () => void;
  };
  saveReconcile: () => Promise<{ error: { message?: string } | null }>;
  onSuccess: () => Promise<void>;
}

export async function executeReconcileSave({
  isSalaryAuthorized,
  userId,
  businessId,
  selectedExpenseId,
  reconcileAction,
  selectedStaffPaymentId,
  callbacks,
  saveReconcile,
  onSuccess,
}: ExecuteReconcileSaveParams): Promise<boolean> {
  if (!isSalaryAuthorized || !userId || !businessId || !selectedExpenseId) {
    return false;
  }
  if (reconcileAction === 'linked_duplicate' && !selectedStaffPaymentId) {
    callbacks.setError('Please select the matching teacher payment record.');
    return false;
  }

  callbacks.setSubmitting(true);
  callbacks.setError(null);

  try {
    const { error } = await saveReconcile();
    if (error) {
      callbacks.setError(formatSafeReconcileError(error));
      return false;
    }

    callbacks.setConfirming(false);
    callbacks.setModalOpen(false);
    callbacks.clearSelectedExpense();
    await onSuccess();
    return true;
  } catch (err) {
    callbacks.setError(formatSafeReconcileError(err));
    return false;
  } finally {
    callbacks.setSubmitting(false);
  }
}
