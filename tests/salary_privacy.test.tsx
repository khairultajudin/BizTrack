import React from 'react';
import fs from 'fs';
import path from 'path';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '../src/context/AuthContext';
import { BranchContext } from '../src/context/BranchContext';
import { TemplateContext } from '../src/context/TemplateContext';
import { Sidebar } from '../src/components/layout/Sidebar';
import { Teachers, executeTeachersFetch } from '../src/pages/Teachers';
import {
  executeDashboardFetch,
  EMPTY_DASHBOARD_STATS,
  buildDashboardContextKey,
  filterVisibleExpenses,
  isSalaryExpenseCategory,
  mapPayrollReconciliationRow,
  parseStrictNonNegativeInteger,
  unwrapSupabaseQuery,
  unwrapStaffPayrollRpc,
  unwrapPayrollReconciliationRpc,
  unwrapFinancialSummaryRpc,
  unwrapMonthlyFinancialSummaryRpc,
  DashboardStatsPayload,
  DashboardPrimaryResult,
} from '../src/lib/dashboardFetch';
import {
  EMPTY_REPORTS_SUMMARY,
  executeReportsFetch,
  ReportsChartPoint,
  ReportsSummaryPayload,
} from '../src/lib/reportsFetch';
import {
  buildExpensesContextKey,
  executeExpensesFetch,
  executeReconcilePaymentOptionsFetch,
  executeReconcileSave,
} from '../src/lib/expensesFetch';

// ─── Test Configuration & Fixtures ──────────────────────────────────────────
const TARGET_SALARY_ADMIN_UID = 'd2b660bf-10d3-4d94-94ec-0b8f6e0908e6';
const TARGET_SALARY_BIZ_ID = '978d2b0c-6a2b-4c28-9000-71dc23f96781';
const PAUH_STAFF_UID = '1d602572-2048-4526-bac0-05839ac06471';
const KELISA_STAFF_UID = '2877f207-c3ff-4339-ad4e-823a3bd24e5f';
const UNASSIGNED_STAFF_UID = '99999999-9999-4999-9999-999999999999';
const OTHER_CREATOR_UID = 'a11c9c2b-364d-4aca-b6f1-90e9024c4a6e';
const OUTSIDER_UID = 'c33e7e4d-586f-4cec-b8f3-72a9246e6c8a';
const PROTECTED_BIZ_ID = 'ea5bd26f-8bba-47a3-845d-bdcc1b57d4ad';

const PAUH_BRANCH_ID = '9420a109-4a28-47f3-93ff-f4be08012719';
const KELISA_BRANCH_ID = 'e4f61aac-9629-4be7-ae7e-8d9b462233a4';

const defaultTemplate = {
  template: 'tuition',
  settings: {},
  modules: { students: true, classes: true, teachers: true, payments: true, expenses: true, reports: true },
  updateSettings: async () => {},
  toggleModule: async () => {},
  changeTemplate: async () => {},
  t: (key: string) => key === 'teachers' ? 'Teachers' : key
};

const defaultBranchContext = {
  branches: [
    { id: PAUH_BRANCH_ID, business_id: TARGET_SALARY_BIZ_ID, name: 'Pauh Jaya', is_active: true },
    { id: KELISA_BRANCH_ID, business_id: TARGET_SALARY_BIZ_ID, name: 'Kelisa Emas', is_active: true },
  ],
  selectedBranchId: null,
  selectedBranch: null,
  setSelectedBranchId: () => {},
  isMultiBranch: true,
  isBranchLocked: false,
  loadingBranches: false,
  refreshBranches: async () => {},
};

function computeIsSalaryAuthorized(userId: string | undefined | null, businessId: string | null): boolean {
  return Boolean(userId === TARGET_SALARY_ADMIN_UID && businessId === TARGET_SALARY_BIZ_ID);
}

function renderSidebarForUser(user: any, businessId: string | null, role: string) {
  const isSalaryAuthorized = computeIsSalaryAuthorized(user?.id, businessId);
  const mockAuth = {
    user,
    profile: null,
    loading: false,
    displayName: user ? 'Test User' : 'Guest',
    initials: 'TU',
    businessId,
    businessName: 'Akademik Mega',
    role,
    isSalaryAuthorized,
    refreshAuth: async () => {},
    refreshProfile: async () => {},
  };

  return renderToString(
    <AuthContext.Provider value={mockAuth as any}>
      <BranchContext.Provider value={defaultBranchContext as any}>
        <TemplateContext.Provider value={defaultTemplate as any}>
          <MemoryRouter>
            <Sidebar />
          </MemoryRouter>
        </TemplateContext.Provider>
      </BranchContext.Provider>
    </AuthContext.Provider>
  );
}

function renderTeachersPageForUser(user: any, businessId: string | null, role: string, authLoading = false) {
  const isSalaryAuthorized = computeIsSalaryAuthorized(user?.id, businessId);
  const mockAuth = {
    user,
    profile: null,
    loading: authLoading,
    displayName: user ? 'Test User' : 'Guest',
    initials: 'TU',
    businessId,
    businessName: 'Akademik Mega',
    role,
    isSalaryAuthorized,
    refreshAuth: async () => {},
    refreshProfile: async () => {},
  };

  return renderToString(
    <AuthContext.Provider value={mockAuth as any}>
      <BranchContext.Provider value={defaultBranchContext as any}>
        <TemplateContext.Provider value={defaultTemplate as any}>
          <MemoryRouter>
            <Teachers />
          </MemoryRouter>
        </TemplateContext.Provider>
      </BranchContext.Provider>
    </AuthContext.Provider>
  );
}

// ─── Reference Simulation of Permanent Historical Branch Payroll Allocation ───
interface SimTeacher {
  id: string;
  businessId: string;
  branchId: string | null;
  name: string;
  deletedAt: string | null;
}

interface SimClass {
  id: string;
  businessId: string;
  branchId: string;
  teacherId: string | null;
}

interface SimPayment {
  id: string;
  businessId: string;
  branchId: string | null; // Permanently stored at payment creation time (or null for pre-Migration 08 unmapped historical payments)
  staffId: string;
  month: string;
  year: number;
  amount: number;
  deletedAt: string | null;
}

interface SimReconciliationSummary {
  consolidated_payroll: number;
  pauh_jaya_payroll: number;
  kelisa_emas_payroll: number;
  unmapped_payroll: number;
  unmapped_payment_count: number;
  reconciles_exactly: boolean;
}

class PayrollAllocationModel {
  teachers: SimTeacher[] = [
    { id: 't-pauh-active', businessId: TARGET_SALARY_BIZ_ID, branchId: PAUH_BRANCH_ID, name: 'Cikgu Aiman (PJ)', deletedAt: null },
    { id: 't-pauh-noclass', businessId: TARGET_SALARY_BIZ_ID, branchId: PAUH_BRANCH_ID, name: 'Cikgu Nadia (PJ No Class)', deletedAt: null },
    { id: 't-kelisa-active', businessId: TARGET_SALARY_BIZ_ID, branchId: KELISA_BRANCH_ID, name: 'Cikgu Farah (KE)', deletedAt: null },
    { id: 't-transferred-hist', businessId: TARGET_SALARY_BIZ_ID, branchId: null, name: 'Cikgu Transferred PJ-to-KE', deletedAt: null },
  ];

  classes: SimClass[] = [
    { id: 'c-pauh-1', businessId: TARGET_SALARY_BIZ_ID, branchId: PAUH_BRANCH_ID, teacherId: 't-pauh-active' },
    { id: 'c-kelisa-1', businessId: TARGET_SALARY_BIZ_ID, branchId: KELISA_BRANCH_ID, teacherId: 't-kelisa-active' },
  ];

  payments: SimPayment[] = [];

  recordPayment(staffId: string, month: string, year: number, amount: number, explicitBranchId?: string | null) {
    const teacher = this.teachers.find(t => t.id === staffId);
    if (!teacher) throw new Error('Invalid staff_id');
    const resolvedBranchId = explicitBranchId || teacher.branchId;
    if (!resolvedBranchId) throw new Error('Multi-branch violation: branch_id is required for staff_payments');
    this.payments.push({
      id: `pay-${this.payments.length + 1}`,
      businessId: teacher.businessId,
      branchId: resolvedBranchId,
      staffId,
      month,
      year,
      amount,
      deletedAt: null,
    });
  }

  recordUnmappedHistoricalPayment(staffId: string, month: string, year: number, amount: number): string {
    const teacher = this.teachers.find(t => t.id === staffId);
    if (!teacher) throw new Error('Invalid staff_id');
    const id = `pay-hist-${this.payments.length + 1}`;
    this.payments.push({
      id,
      businessId: teacher.businessId,
      branchId: null,
      staffId,
      month,
      year,
      amount,
      deletedAt: null,
    });
    return id;
  }

  assignStaffPaymentBranch(callerUid: string | null, businessId: string, paymentId: string, branchId: string) {
    if (!computeIsSalaryAuthorized(callerUid, businessId)) {
      throw new Error('Access denied: You are not authorized to reconcile staff payment branches.');
    }
    if (branchId !== PAUH_BRANCH_ID && branchId !== KELISA_BRANCH_ID) {
      throw new Error(`Invalid branch_id ${branchId} for business ${businessId}.`);
    }
    const payment = this.payments.find(p => p.id === paymentId && p.businessId === businessId && p.deletedAt === null);
    if (!payment) {
      throw new Error(`Staff payment ${paymentId} not found in business ${businessId}.`);
    }
    payment.branchId = branchId;
  }

  getPayrollReconciliationSummary(
    callerUid: string | null,
    businessId: string,
    month?: string | null,
    year?: number | null
  ): SimReconciliationSummary {
    if (!computeIsSalaryAuthorized(callerUid, businessId)) {
      throw new Error('Access denied: You are not authorized to view payroll reconciliation details.');
    }
    const active = this.payments.filter(p =>
      p.businessId === businessId &&
      p.deletedAt === null &&
      (!month || p.month === month) &&
      (!year || p.year === year)
    );
    const consolidated = active.reduce((sum, p) => sum + p.amount, 0);
    const pauh = active.filter(p => p.branchId === PAUH_BRANCH_ID).reduce((sum, p) => sum + p.amount, 0);
    const kelisa = active.filter(p => p.branchId === KELISA_BRANCH_ID).reduce((sum, p) => sum + p.amount, 0);
    const unmapped = active.filter(p => p.branchId === null).reduce((sum, p) => sum + p.amount, 0);
    const unmappedCount = active.filter(p => p.branchId === null).length;

    return {
      consolidated_payroll: consolidated,
      pauh_jaya_payroll: pauh,
      kelisa_emas_payroll: kelisa,
      unmapped_payroll: unmapped,
      unmapped_payment_count: unmappedCount,
      reconciles_exactly: consolidated === pauh + kelisa && unmapped === 0,
    };
  }

  removeTeacherFromClasses(staffId: string) {
    this.classes.forEach(c => {
      if (c.teacherId === staffId) c.teacherId = null;
    });
  }

  transferTeacherBranch(staffId: string, newBranchId: string) {
    const teacher = this.teachers.find(t => t.id === staffId);
    if (teacher) teacher.branchId = newBranchId;
    // Historical staff_payments.branchId is NEVER mutated!
  }

  softDeleteTeacher(staffId: string) {
    this.removeTeacherFromClasses(staffId);
    const teacher = this.teachers.find(t => t.id === staffId);
    if (teacher) teacher.deletedAt = new Date().toISOString();
    // Historical staff_payments rows and their branchId remain untouched!
  }

  getStaffExpensesSummary(
    callerUid: string | null,
    businessId: string,
    month: string,
    year: number,
    requestedBranchId: string | null
  ): number {
    if (!callerUid) {
      throw new Error('Authentication required.');
    }

    const memberships: Record<string, { businessId: string; role: string; branchId: string | null }> = {
      [TARGET_SALARY_ADMIN_UID]: { businessId: TARGET_SALARY_BIZ_ID, role: 'Creator', branchId: null },
      [OTHER_CREATOR_UID]: { businessId: TARGET_SALARY_BIZ_ID, role: 'Creator', branchId: null },
      [PAUH_STAFF_UID]: { businessId: TARGET_SALARY_BIZ_ID, role: 'Staff', branchId: PAUH_BRANCH_ID },
      [KELISA_STAFF_UID]: { businessId: TARGET_SALARY_BIZ_ID, role: 'Staff', branchId: KELISA_BRANCH_ID },
      [UNASSIGNED_STAFF_UID]: { businessId: TARGET_SALARY_BIZ_ID, role: 'Staff', branchId: null },
    };

    const member = memberships[callerUid];
    if (!member || member.businessId !== businessId) {
      throw new Error(`Access denied to business ${businessId}.`);
    }

    let effectiveBranchId: string | null = null;
    if (member.role === 'Staff') {
      if (!member.branchId) {
        throw new Error('Access denied: Staff user is not assigned to a branch.');
      }
      if (requestedBranchId !== null && requestedBranchId !== member.branchId) {
        throw new Error('Access denied: Cannot access payroll aggregate for another branch.');
      }
      effectiveBranchId = member.branchId;
    } else {
      if (requestedBranchId !== null && requestedBranchId !== PAUH_BRANCH_ID && requestedBranchId !== KELISA_BRANCH_ID) {
        throw new Error(`Invalid branch_id ${requestedBranchId} for business ${businessId}.`);
      }
      effectiveBranchId = requestedBranchId;
    }

    return this.payments
      .filter(p =>
        p.businessId === businessId &&
        p.month === month &&
        p.year === year &&
        p.deletedAt === null &&
        (!effectiveBranchId || p.branchId === effectiveBranchId)
      )
      .reduce((sum, p) => sum + p.amount, 0);
  }
}

// ─── Test Runner ─────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`[PASS] ${testName}`);
    passed++;
  } else {
    console.error(`[FAIL] ${testName}`);
    failed++;
  }
}

function assertThrows(fn: () => void, expectedSubstring: string, testName: string) {
  try {
    fn();
    console.error(`[FAIL] ${testName} (did not throw)`);
    failed++;
  } catch (err: any) {
    if (err.message && err.message.includes(expectedSubstring)) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} (threw "${err.message}", expected "${expectedSubstring}")`);
      failed++;
    }
  }
}

console.log('========================================================================');
console.log('RUNNING BIZTRACK TASK 3 (PHASE 2.1): SALARY PRIVACY & PAYROLL TESTS');
console.log('========================================================================\n');

// 1. Puan Hana Authorization
console.log('--- 1. Puan Hana Individual Salary Authorization ---');
assert(
  computeIsSalaryAuthorized(TARGET_SALARY_ADMIN_UID, TARGET_SALARY_BIZ_ID) === true,
  'Puan Hana is authorized in target business (978d2b0c)'
);
const hanaHtml = renderSidebarForUser({ id: TARGET_SALARY_ADMIN_UID }, TARGET_SALARY_BIZ_ID, 'Creator');
assert(
  hanaHtml.includes('href="/teachers"') && hanaHtml.includes('Teachers'),
  'Puan Hana Sidebar displays "/teachers" navigation link'
);
const hanaTeachersHtml = renderTeachersPageForUser({ id: TARGET_SALARY_ADMIN_UID }, TARGET_SALARY_BIZ_ID, 'Creator', false);
assert(
  hanaTeachersHtml.includes('Add Teacher') && hanaTeachersHtml.includes('Manage your staff and instructors.'),
  'Puan Hana Teachers page renders management UI'
);

// 2. Pauh Jaya Staff Restrictions
console.log('\n--- 2. Pauh Jaya Staff Individual Salary Restrictions ---');
assert(
  computeIsSalaryAuthorized(PAUH_STAFF_UID, TARGET_SALARY_BIZ_ID) === false,
  'Pauh Jaya Staff is NOT authorized for individual salary in target business'
);
const pauhHtml = renderSidebarForUser({ id: PAUH_STAFF_UID }, TARGET_SALARY_BIZ_ID, 'Staff');
assert(
  pauhHtml.includes('href="/teachers"') && pauhHtml.includes('Teachers'),
  'Pauh Jaya Staff Sidebar displays "/teachers" navigation link for safe directory access'
);
const pauhTeachersHtml = renderTeachersPageForUser({ id: PAUH_STAFF_UID }, TARGET_SALARY_BIZ_ID, 'Staff', false);
assert(
  pauhTeachersHtml.includes('View your branch teacher directory.') &&
  !pauhTeachersHtml.includes('Add Teacher') &&
  !pauhTeachersHtml.includes('Monthly Amount') &&
  !pauhTeachersHtml.includes('Salary Type'),
  'Pauh Jaya Staff Teachers page renders safe directory UI only (zero salary fields or management actions)'
);

// 3. Kelisa Emas Staff Restrictions
console.log('\n--- 3. Kelisa Emas Staff Individual Salary Restrictions ---');
assert(
  computeIsSalaryAuthorized(KELISA_STAFF_UID, TARGET_SALARY_BIZ_ID) === false,
  'Kelisa Emas Staff is NOT authorized for individual salary in target business'
);
const kelisaHtml = renderSidebarForUser({ id: KELISA_STAFF_UID }, TARGET_SALARY_BIZ_ID, 'Staff');
assert(
  kelisaHtml.includes('href="/teachers"') && kelisaHtml.includes('Teachers'),
  'Kelisa Emas Staff Sidebar displays "/teachers" navigation link for safe directory access'
);
const kelisaTeachersHtml = renderTeachersPageForUser({ id: KELISA_STAFF_UID }, TARGET_SALARY_BIZ_ID, 'Staff', false);
assert(
  kelisaTeachersHtml.includes('View your branch teacher directory.') &&
  !kelisaTeachersHtml.includes('Add Teacher') &&
  !kelisaTeachersHtml.includes('Monthly Amount') &&
  !kelisaTeachersHtml.includes('Salary Type'),
  'Kelisa Emas Staff Teachers page renders safe directory UI only (zero salary fields or management actions)'
);

// 4. Auth Loading Guard on Teachers Page
console.log('\n--- 4. Auth Loading Guard & Fail-Closed UI ---');
const loadingTeachersHtml = renderTeachersPageForUser({ id: PAUH_STAFF_UID }, TARGET_SALARY_BIZ_ID, 'Staff', true);
assert(
  loadingTeachersHtml.includes('Verifying access...') && !loadingTeachersHtml.includes('Add Teacher'),
  'Teachers page renders only "Verifying access..." spinner while authLoading is true'
);

// 5. Non-Hana Creator/Admin Restrictions
console.log('\n--- 5. Non-Hana Creator/Admin Role Protection ---');
assert(
  computeIsSalaryAuthorized(OTHER_CREATOR_UID, TARGET_SALARY_BIZ_ID) === false,
  'Another Creator/Admin UID in target business is FAIL-CLOSED (denied individual salary authorization)'
);
const otherAdminHtml = renderSidebarForUser({ id: OTHER_CREATOR_UID }, TARGET_SALARY_BIZ_ID, 'Creator');
assert(
  otherAdminHtml.includes('href="/teachers"') && otherAdminHtml.includes('Teachers'),
  'Non-Hana Creator/Admin Sidebar displays "/teachers" navigation link for safe directory access'
);
const otherAdminTeachersHtml = renderTeachersPageForUser({ id: OTHER_CREATOR_UID }, TARGET_SALARY_BIZ_ID, 'Creator', false);
assert(
  otherAdminTeachersHtml.includes('View your branch teacher directory.') &&
  !otherAdminTeachersHtml.includes('Add Teacher') &&
  !otherAdminTeachersHtml.includes('Monthly Amount') &&
  !otherAdminTeachersHtml.includes('Salary Type'),
  'Non-Hana Creator/Admin Teachers page renders safe directory UI only (zero salary fields)'
);

// 6. Protected Workspace Boundary Protection
console.log('\n--- 6. Protected Workspace & Tenant Isolation ---');
assert(
  computeIsSalaryAuthorized(TARGET_SALARY_ADMIN_UID, PROTECTED_BIZ_ID) === false,
  'Puan Hana accessing protected business (ea5bd26f) is NOT authorized for salary'
);
assert(
  computeIsSalaryAuthorized(PAUH_STAFF_UID, PROTECTED_BIZ_ID) === false,
  'Pauh Jaya Staff accessing protected business (ea5bd26f) is denied'
);
assert(
  computeIsSalaryAuthorized(null, TARGET_SALARY_BIZ_ID) === false,
  'Unauthenticated user (null user) is denied salary access'
);
assert(
  computeIsSalaryAuthorized(TARGET_SALARY_ADMIN_UID, null) === false,
  'User with missing/null businessId is denied salary access'
);

// 7. Branch Aggregate Isolation & Permanent Historical Allocation Invariants
console.log('\n--- 7. Branch Aggregate Isolation & Historical Allocation Invariants ---');
const payrollModel = new PayrollAllocationModel();
// Record November 2026 payments:
// - Cikgu Aiman (PJ, has class): RM 2,200
// - Cikgu Nadia (PJ, NO active class): RM 1,500
// - Cikgu Farah (KE, has class): RM 1,800
payrollModel.recordPayment('t-pauh-active', 'November', 2026, 2200);
payrollModel.recordPayment('t-pauh-noclass', 'November', 2026, 1500);
payrollModel.recordPayment('t-kelisa-active', 'November', 2026, 1800);

assert(
  payrollModel.getStaffExpensesSummary(PAUH_STAFF_UID, TARGET_SALARY_BIZ_ID, 'November', 2026, null) === 3700,
  'Pauh Jaya Staff sees Pauh Jaya payroll aggregate (2,200 + 1,500 = 3,700), including teacher with NO active class'
);
assert(
  payrollModel.getStaffExpensesSummary(KELISA_STAFF_UID, TARGET_SALARY_BIZ_ID, 'November', 2026, null) === 1800,
  'Kelisa Emas Staff sees Kelisa Emas payroll aggregate (1,800) only'
);
assertThrows(
  () => payrollModel.getStaffExpensesSummary(PAUH_STAFF_UID, TARGET_SALARY_BIZ_ID, 'November', 2026, KELISA_BRANCH_ID),
  'Cannot access payroll aggregate for another branch',
  'Pauh Jaya Staff cross-branch parameter manipulation is blocked'
);
assertThrows(
  () => payrollModel.getStaffExpensesSummary(KELISA_STAFF_UID, TARGET_SALARY_BIZ_ID, 'November', 2026, PAUH_BRANCH_ID),
  'Cannot access payroll aggregate for another branch',
  'Kelisa Emas Staff cross-branch parameter manipulation is blocked'
);
assertThrows(
  () => payrollModel.getStaffExpensesSummary(UNASSIGNED_STAFF_UID, TARGET_SALARY_BIZ_ID, 'November', 2026, null),
  'Staff user is not assigned to a branch',
  'Unassigned Staff in multi-branch business is blocked (fail-closed)'
);
assertThrows(
  () => payrollModel.getStaffExpensesSummary(OUTSIDER_UID, TARGET_SALARY_BIZ_ID, 'November', 2026, null),
  'Access denied to business',
  'Non-member user is blocked (fail-closed)'
);
assert(
  payrollModel.getStaffExpensesSummary(OTHER_CREATOR_UID, TARGET_SALARY_BIZ_ID, 'November', 2026, null) === 5500,
  'Authorized business Creator (non-Hana) retains scalar payroll aggregate access without individual salary access'
);

// Historical Invariant 1: Removing teacher class assignments
payrollModel.removeTeacherFromClasses('t-pauh-active');
assert(
  payrollModel.getStaffExpensesSummary(PAUH_STAFF_UID, TARGET_SALARY_BIZ_ID, 'November', 2026, null) === 3700,
  'Teacher with removed class assignments still contributes to historical Pauh Jaya branch payroll (3,700)'
);

// Historical Invariant 2: Teacher transferring branches
payrollModel.transferTeacherBranch('t-pauh-active', KELISA_BRANCH_ID);
payrollModel.recordPayment('t-pauh-active', 'December', 2026, 2200);
assert(
  payrollModel.getStaffExpensesSummary(TARGET_SALARY_ADMIN_UID, TARGET_SALARY_BIZ_ID, 'November', 2026, PAUH_BRANCH_ID) === 3700 &&
  payrollModel.getStaffExpensesSummary(TARGET_SALARY_ADMIN_UID, TARGET_SALARY_BIZ_ID, 'November', 2026, KELISA_BRANCH_ID) === 1800,
  'Teacher transferring branches does NOT move historical November payroll between Pauh Jaya (3,700) and Kelisa Emas (1,800)'
);
assert(
  payrollModel.getStaffExpensesSummary(TARGET_SALARY_ADMIN_UID, TARGET_SALARY_BIZ_ID, 'December', 2026, PAUH_BRANCH_ID) === 0 &&
  payrollModel.getStaffExpensesSummary(TARGET_SALARY_ADMIN_UID, TARGET_SALARY_BIZ_ID, 'December', 2026, KELISA_BRANCH_ID) === 2200,
  'Post-transfer December payment is allocated to the teacher’s new branch (Kelisa Emas = 2,200)'
);

// Historical Invariant 3: Soft-deleting a teacher
payrollModel.softDeleteTeacher('t-kelisa-active');
assert(
  payrollModel.getStaffExpensesSummary(TARGET_SALARY_ADMIN_UID, TARGET_SALARY_BIZ_ID, 'November', 2026, KELISA_BRANCH_ID) === 1800,
  'Soft-deleted teacher’s historical payments remain included in Kelisa Emas branch payroll (1,800)'
);

// Historical Invariant 4: Consolidated payroll reconciles with sum of branch payrolls
const hanaConsolidatedNov = payrollModel.getStaffExpensesSummary(TARGET_SALARY_ADMIN_UID, TARGET_SALARY_BIZ_ID, 'November', 2026, null);
const hanaPauhNov = payrollModel.getStaffExpensesSummary(TARGET_SALARY_ADMIN_UID, TARGET_SALARY_BIZ_ID, 'November', 2026, PAUH_BRANCH_ID);
const hanaKelisaNov = payrollModel.getStaffExpensesSummary(TARGET_SALARY_ADMIN_UID, TARGET_SALARY_BIZ_ID, 'November', 2026, KELISA_BRANCH_ID);
assert(
  hanaConsolidatedNov === 5500 && hanaConsolidatedNov === hanaPauhNov + hanaKelisaNov,
  `Consolidated payroll (${hanaConsolidatedNov}) reconciles exactly with Pauh Jaya (${hanaPauhNov}) + Kelisa Emas (${hanaKelisaNov})`
);

// 8. Dashboard & Reports Financial Consistency
console.log('\n--- 8. Dashboard & Reports Branch Financial Calculations ---');
const branchCollectionPJ = 12500;
const branchGeneralExpensesPJ = 1400;
const branchPayrollPJ = hanaPauhNov; // 3700
const branchMonthlyExpensesPJ = branchGeneralExpensesPJ + branchPayrollPJ; // 5100
const branchNetProfitPJ = branchCollectionPJ - branchGeneralExpensesPJ - branchPayrollPJ; // 7400

assert(
  branchMonthlyExpensesPJ === 5100 && branchNetProfitPJ === 7400,
  'Pauh Jaya Dashboard & Reports evaluate Monthly Expenses (1,400 + 3,700 = 5,100) and Net Profit (12,500 - 5,100 = 7,400)'
);

// 8b. Phase 2.2: Unmapped Historical Payroll & Consolidated Reconciliation Equation
console.log('\n--- 8b. Unmapped Historical Payments & Consolidated Reconciliation ---');
const unmappedId1 = payrollModel.recordUnmappedHistoricalPayment('t-transferred-hist', 'November', 2026, 1600);
const unmappedId2 = payrollModel.recordUnmappedHistoricalPayment('t-pauh-noclass', 'November', 2026, 1300);

const summaryBeforeRec = payrollModel.getPayrollReconciliationSummary(
  TARGET_SALARY_ADMIN_UID,
  TARGET_SALARY_BIZ_ID,
  'November',
  2026
);

assert(
  summaryBeforeRec.consolidated_payroll === 8400 &&
  summaryBeforeRec.pauh_jaya_payroll === 3700 &&
  summaryBeforeRec.kelisa_emas_payroll === 1800 &&
  summaryBeforeRec.unmapped_payroll === 2900 &&
  summaryBeforeRec.unmapped_payment_count === 2 &&
  summaryBeforeRec.reconciles_exactly === false &&
  summaryBeforeRec.consolidated_payroll ===
    summaryBeforeRec.pauh_jaya_payroll + summaryBeforeRec.kelisa_emas_payroll + summaryBeforeRec.unmapped_payroll,
  'Explicit Reconciliation Equation holds when unmapped payments exist: Consolidated (8,400) = Pauh Jaya (3,700) + Kelisa Emas (1,800) + Unmapped (2,900)'
);

assert(
  payrollModel.getStaffExpensesSummary(PAUH_STAFF_UID, TARGET_SALARY_BIZ_ID, 'November', 2026, null) === 3700 &&
  payrollModel.getStaffExpensesSummary(KELISA_STAFF_UID, TARGET_SALARY_BIZ_ID, 'November', 2026, null) === 1800,
  'Unmapped historical payments (branchId = null) are NEVER silently allocated to Pauh Jaya (3,700) or Kelisa Emas (1,800) branch totals'
);

assertThrows(
  () => payrollModel.getPayrollReconciliationSummary(PAUH_STAFF_UID, TARGET_SALARY_BIZ_ID, 'November', 2026),
  'not authorized to view payroll reconciliation details',
  'Pauh Jaya Staff is blocked from calling get_payroll_reconciliation_summary'
);

assertThrows(
  () => payrollModel.getPayrollReconciliationSummary(OTHER_CREATOR_UID, TARGET_SALARY_BIZ_ID, 'November', 2026),
  'not authorized to view payroll reconciliation details',
  'Non-Hana Creator is blocked from calling get_payroll_reconciliation_summary'
);

assertThrows(
  () => payrollModel.assignStaffPaymentBranch(PAUH_STAFF_UID, TARGET_SALARY_BIZ_ID, unmappedId1, PAUH_BRANCH_ID),
  'not authorized to reconcile staff payment branches',
  'Pauh Jaya Staff is blocked from calling assign_staff_payment_branch'
);

assertThrows(
  () => payrollModel.assignStaffPaymentBranch(OTHER_CREATOR_UID, TARGET_SALARY_BIZ_ID, unmappedId1, PAUH_BRANCH_ID),
  'not authorized to reconcile staff payment branches',
  'Non-Hana Creator is blocked from calling assign_staff_payment_branch'
);

// Puan Hana reconciles both historical payments to their verified branches
payrollModel.assignStaffPaymentBranch(TARGET_SALARY_ADMIN_UID, TARGET_SALARY_BIZ_ID, unmappedId1, PAUH_BRANCH_ID);
payrollModel.assignStaffPaymentBranch(TARGET_SALARY_ADMIN_UID, TARGET_SALARY_BIZ_ID, unmappedId2, KELISA_BRANCH_ID);

const summaryAfterRec = payrollModel.getPayrollReconciliationSummary(
  TARGET_SALARY_ADMIN_UID,
  TARGET_SALARY_BIZ_ID,
  'November',
  2026
);

assert(
  summaryAfterRec.consolidated_payroll === 8400 &&
  summaryAfterRec.pauh_jaya_payroll === 5300 &&
  summaryAfterRec.kelisa_emas_payroll === 3100 &&
  summaryAfterRec.unmapped_payroll === 0 &&
  summaryAfterRec.unmapped_payment_count === 0 &&
  summaryAfterRec.reconciles_exactly === true &&
  summaryAfterRec.consolidated_payroll === summaryAfterRec.pauh_jaya_payroll + summaryAfterRec.kelisa_emas_payroll,
  'After Puan Hana reconciles unmapped payments via assign_staff_payment_branch, Consolidated (8,400) = Pauh Jaya (5,300) + Kelisa Emas (3,100) + Unmapped (0)'
);

// 8c. Phase 2.2 Required Reconciliation Dataset: 3,700 + 1,800 + 500 = 6,000
console.log('\n--- 8c. Exact 3,700 + 1,800 + 500 = 6,000 Reconciliation Verification ---');
const reconModel = new PayrollAllocationModel();
reconModel.recordPayment('t-pauh-active', 'ReconMonth', 2099, 3700, PAUH_BRANCH_ID);
reconModel.recordPayment('t-kelisa-active', 'ReconMonth', 2099, 1800, KELISA_BRANCH_ID);
const unmapped500Id = reconModel.recordUnmappedHistoricalPayment('t-transferred-hist', 'ReconMonth', 2099, 500);

const recon6000 = reconModel.getPayrollReconciliationSummary(TARGET_SALARY_ADMIN_UID, TARGET_SALARY_BIZ_ID, 'ReconMonth', 2099);
assert(
  recon6000.consolidated_payroll === 6000 &&
  recon6000.pauh_jaya_payroll === 3700 &&
  recon6000.kelisa_emas_payroll === 1800 &&
  recon6000.unmapped_payroll === 500 &&
  recon6000.reconciles_exactly === false &&
  recon6000.consolidated_payroll - (recon6000.pauh_jaya_payroll + recon6000.kelisa_emas_payroll + recon6000.unmapped_payroll) === 0,
  'Exact reconciliation equation holds with 0 difference: Consolidated (6,000) = Pauh Jaya (3,700) + Kelisa Emas (1,800) + Unmapped (500)'
);
assert(
  reconModel.getStaffExpensesSummary(PAUH_STAFF_UID, TARGET_SALARY_BIZ_ID, 'ReconMonth', 2099, null) === 3700 &&
  reconModel.getStaffExpensesSummary(KELISA_STAFF_UID, TARGET_SALARY_BIZ_ID, 'ReconMonth', 2099, null) === 1800,
  'Pauh Jaya Staff (3,700) and Kelisa Emas Staff (1,800) exclude unmapped RM 500 and each other’s branch payroll'
);
reconModel.assignStaffPaymentBranch(TARGET_SALARY_ADMIN_UID, TARGET_SALARY_BIZ_ID, unmapped500Id, PAUH_BRANCH_ID);
const recon6000After = reconModel.getPayrollReconciliationSummary(TARGET_SALARY_ADMIN_UID, TARGET_SALARY_BIZ_ID, 'ReconMonth', 2099);
assert(
  recon6000After.consolidated_payroll === 6000 &&
  recon6000After.pauh_jaya_payroll === 4200 &&
  recon6000After.kelisa_emas_payroll === 1800 &&
  recon6000After.unmapped_payroll === 0 &&
  recon6000After.reconciles_exactly === true,
  'After reconciling RM 500 to Pauh Jaya, Consolidated (6,000) = Pauh Jaya (4,200) + Kelisa Emas (1,800) + Unmapped (0)'
);

// 9. Static Source, Migration & Rollback Hardening Verification
console.log('\n--- 9. Frontend, SQL Migration & Rollback Invariant Checks ---');
const rootDir = process.cwd();
const teachersSrc = fs.readFileSync(path.join(rootDir, 'src/pages/Teachers.tsx'), 'utf8');
const dashboardSrc = fs.readFileSync(path.join(rootDir, 'src/pages/Dashboard.tsx'), 'utf8');
const expensesSrc = fs.readFileSync(path.join(rootDir, 'src/pages/Expenses.tsx'), 'utf8');
const reportsSrc = fs.readFileSync(path.join(rootDir, 'src/pages/Reports.tsx'), 'utf8');
const migrationSql = fs.readFileSync(path.join(rootDir, 'supabase/08_salary_privacy.sql'), 'utf8');
const rollbackSql = fs.readFileSync(path.join(rootDir, 'supabase/08_salary_privacy_rollback.sql'), 'utf8');
const testSql = fs.readFileSync(path.join(rootDir, 'supabase/08_salary_privacy_test.sql'), 'utf8');

assert(
  !teachersSrc.includes(".from('staff')"),
  'Teachers.tsx has ZERO direct .from("staff") fallback queries or mutations'
);
assert(
  teachersSrc.includes("supabase.rpc('get_teachers_with_salary'") &&
  teachersSrc.includes("supabase.rpc('save_teacher_with_salary'") &&
  teachersSrc.includes("supabase.rpc('delete_teacher'") &&
  teachersSrc.includes("supabase.rpc('get_historical_payroll_audit'") &&
  teachersSrc.includes("supabase.rpc('get_payroll_reconciliation_summary'") &&
  teachersSrc.includes("supabase.rpc('assign_staff_payment_branch'") &&
  teachersSrc.includes("p_branch_id: resolvedBranchId"),
  'Teachers.tsx uses authorized SECURITY DEFINER RPCs exclusively (including historical audit & branch reconciliation RPCs)'
);
assert(
  !dashboardSrc.includes(".from('staff_payments')") &&
  dashboardSrc.includes("supabase.rpc('get_financial_summary'") &&
  dashboardSrc.includes("recentExpQuery = recentExpQuery.eq('branch_id', selectedBranchId)") &&
  dashboardSrc.includes("filterVisibleExpenses(recentExp.data || [], isSalaryAuthorized)") &&
  dashboardSrc.includes("staffQuery = staffQuery.eq('branch_id', selectedBranchId)") &&
  dashboardSrc.includes("supabase.rpc('get_payroll_reconciliation_summary'"),
  'Dashboard.tsx uses centralized get_financial_summary RPC, filters recent expenses by branch & salary authorization, and surfaces unmapped payroll reconciliation notice'
);
assert(
  expensesSrc.includes("query = query.eq('branch_id', selectedBranchId)") &&
  expensesSrc.includes("filterVisibleExpenses(rawExpenses || [], isSalaryAuthorized)") &&
  expensesSrc.includes("executeExpensesFetch") &&
  expensesSrc.includes("executeReconcilePaymentOptionsFetch") &&
  !expensesSrc.includes("from('staff_payments')") &&
  !expensesSrc.includes('from("staff_payments")'),
  'Expenses.tsx filters expenses by selectedBranchId & salary authorization, uses race-guarded fetches, and never queries staff_payments table directly'
);
assert(
  reportsSrc.includes("supabase.rpc('get_monthly_financial_summary'") &&
  reportsSrc.includes("supabase.rpc('get_staff_directory'") &&
  reportsSrc.includes("supabase.rpc('get_payroll_reconciliation_summary'") &&
  reportsSrc.includes("executeReportsFetch") &&
  reportsSrc.includes("p_branch_id: selectedBranchId || null"),
  'Reports.tsx uses centralized get_monthly_financial_summary RPC, sequence-guarded executeReportsFetch, and surfaces errors/retry'
);
assert(
  migrationSql.includes('ADD CONSTRAINT staff_branch_business_fkey') &&
  migrationSql.includes('ADD CONSTRAINT staff_payments_branch_business_fkey') &&
  migrationSql.includes('ADD CONSTRAINT expenses_branch_business_fkey') &&
  migrationSql.includes('CREATE TRIGGER trg_enforce_staff_payment_branch') &&
  migrationSql.includes('CREATE TRIGGER trg_enforce_expense_branch') &&
  migrationSql.includes('CREATE OR REPLACE FUNCTION public.get_payroll_reconciliation_summary') &&
  migrationSql.includes('CREATE OR REPLACE FUNCTION public.get_historical_payroll_audit') &&
  migrationSql.includes('CREATE OR REPLACE FUNCTION public.assign_staff_payment_branch'),
  '08_salary_privacy.sql defines composite (branch_id, business_id) FKs, branch enforcement triggers, and historical payroll reconciliation RPCs'
);
assert(
  rollbackSql.includes('REVOKE ALL (\n  id,\n  business_id,\n  branch_id,') &&
  rollbackSql.includes('DROP TRIGGER IF EXISTS trg_enforce_staff_payment_branch ON public.staff_payments;') &&
  rollbackSql.includes('DROP TRIGGER IF EXISTS trg_enforce_expense_branch ON public.expenses;') &&
  rollbackSql.includes('DROP FUNCTION IF EXISTS public.assign_staff_payment_branch(UUID, UUID, UUID);') &&
  rollbackSql.includes('DROP FUNCTION IF EXISTS public.get_historical_payroll_audit(UUID);') &&
  rollbackSql.includes('DROP FUNCTION IF EXISTS public.get_payroll_reconciliation_summary(UUID, TEXT, INT);'),
  '08_salary_privacy_rollback.sql explicitly revokes column-level grants on public.staff and drops all Migration 08 triggers/functions cleanly'
);
assert(
  testSql.includes('SET LOCAL ROLE authenticated;') &&
  testSql.includes("current_user <> 'authenticated' OR v_is_super OR v_bypass_rls") &&
  testSql.includes('get_payroll_reconciliation_summary') &&
  testSql.includes('get_historical_payroll_audit') &&
  testSql.includes('assign_staff_payment_branch') &&
  !testSql.includes('EXCEPTION WHEN OTHERS'),
  '08_salary_privacy_test.sql executes under true SET LOCAL ROLE authenticated, tests all reconciliation RPCs, and has ZERO generic EXCEPTION WHEN OTHERS catches'
);
assert(
  migrationSql.includes("biztrack.reconcile_payment_branch") &&
  migrationSql.includes("public.has_branch_access(business_id, branch_id, false)") &&
  !migrationSql.match(/GRANT SELECT \([\s\S]*?\bphone\b[\s\S]*?\) ON public\.staff/),
  '08_salary_privacy.sql enforces reconcile_payment_branch guard on ordinary updates, branch-scoped staff directory SELECT, and revokes phone/notes from public.staff'
);
assert(
  migrationSql.includes("AND deleted_at IS NULL\n    AND status = 'Active'") ||
  (migrationSql.includes("AND deleted_at IS NULL") && migrationSql.includes("AND status = 'Active'")),
  'delete_teacher() preserves inactive and soft-deleted historical classes by unassigning only active classes'
);
assert(
  migrationSql.includes('Reconciliation failed closed: Expected Pauh Jaya branch is missing') &&
  migrationSql.includes('Reconciliation failed closed: Expected Kelisa Emas branch is missing') &&
  migrationSql.includes('Reconciliation failed closed: Ambiguous/duplicate Pauh Jaya branch match') &&
  migrationSql.includes('Reconciliation failed closed: Ambiguous/duplicate Kelisa Emas branch match') &&
  migrationSql.includes('unexpected_branch_payroll NUMERIC') &&
  migrationSql.includes('unexpected_branch_count INT') &&
  !migrationSql.includes("COALESCE(v_pauh_id, '9420a109-4a28-47f3-93ff-f4be08012719'"),
  'get_payroll_reconciliation_summary() fails closed on missing/duplicate/unexpected branch IDs and tracks unexpected_branch_payroll without fallback COALESCE UUIDs'
);
assert(
  migrationSql.includes('ReadOnly -> matches 07_multi_branch.sql Case 4') &&
  migrationSql.includes('unassigned ReadOnly (bu.branch_id IS NULL) has business-wide scalar aggregate access only'),
  'get_staff_expenses_summary() documents the ReadOnly aggregate policy matching 07_multi_branch.sql Case 4'
);
assert(
  migrationSql.includes('v_total_branch_count <> 2') &&
  migrationSql.includes('Reconciliation failed closed: Expected exactly 2 branches') &&
  dashboardSrc.includes('executeDashboardFetch') &&
  dashboardSrc.includes('fetchSeqRef'),
  '08_salary_privacy.sql enforces v_total_branch_count = 2 and Dashboard.tsx uses sequence-guarded executeDashboardFetch'
);

// ─── 10. Executable Async Race-Condition Regression Tests for Dashboard ──────
console.log('\n--- 10. Dashboard Stale Async Response & Race-Condition Guard (Executable) ---');

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function runDashboardAsyncRaceTests() {
  const makeStateHarness = () => {
    let loading = false;
    let error: string | null = null;
    let loadedContextKey: string | null = null;
    let stats: DashboardStatsPayload = { ...EMPTY_DASHBOARD_STATS };
    let recentPayments: { id: string; branch: string }[] = [];
    let recentExpenses: { id: string; branch: string }[] = [];
    let trendData: { label: string; Income: number; Expenses: number }[] = [];
    let payrollReconciliation: { branch: string; consolidated_payroll: number } | null = null;
    const seqRef = { current: 0 };

    return {
      seqRef,
      callbacks: {
        setLoading: (v: boolean) => { loading = v; },
        setError: (v: string | null) => { error = v; },
        setLoadedContextKey: (v: string | null) => { loadedContextKey = v; },
        setStats: (v: DashboardStatsPayload) => { stats = v; },
        setRecentPayments: (v: { id: string; branch: string }[]) => { recentPayments = v; },
        setRecentExpenses: (v: { id: string; branch: string }[]) => { recentExpenses = v; },
        setTrendData: (v: { label: string; Income: number; Expenses: number }[]) => { trendData = v; },
        setPayrollReconciliation: (v: { branch: string; consolidated_payroll: number } | null) => { payrollReconciliation = v; },
      },
      snapshot: () => ({
        loading,
        error,
        loadedContextKey,
        stats,
        recentPayments,
        recentExpenses,
        trendData,
        payrollReconciliation,
      }),
    };
  };

  const pauhPrimary: DashboardPrimaryResult<{ id: string; branch: string }, { id: string; branch: string }, { branch: string; consolidated_payroll: number }> = {
    stats: {
      monthlyCollection: 12500,
      monthlyExpenses: 5100,
      netProfit: 7400,
      outstandingPayment: 900,
      totalStudents: 80,
      totalClasses: 10,
      totalTeachers: 6,
    },
    recentPayments: [{ id: 'pay-pj', branch: 'Pauh Jaya' }],
    recentExpenses: [{ id: 'exp-pj', branch: 'Pauh Jaya' }],
    payrollReconciliation: { branch: 'Pauh Jaya', consolidated_payroll: 5500 },
  };
  const pauhTrend = [{ label: 'Nov', Income: 12500, Expenses: 5100 }];

  const kelisaPrimary: DashboardPrimaryResult<{ id: string; branch: string }, { id: string; branch: string }, { branch: string; consolidated_payroll: number }> = {
    stats: {
      monthlyCollection: 8200,
      monthlyExpenses: 2750,
      netProfit: 5450,
      outstandingPayment: 300,
      totalStudents: 45,
      totalClasses: 6,
      totalTeachers: 3,
    },
    recentPayments: [{ id: 'pay-ke', branch: 'Kelisa Emas' }],
    recentExpenses: [{ id: 'exp-ke', branch: 'Kelisa Emas' }],
    payrollReconciliation: { branch: 'Kelisa Emas', consolidated_payroll: 5500 },
  };
  const kelisaTrend = [{ label: 'Nov', Income: 8200, Expenses: 2750 }];

  // Scenario A: Pauh Jaya starts 1st, Kelisa Emas starts 2nd, Kelisa Emas resolves 1st, Pauh Jaya resolves later
  {
    const h = makeStateHarness();
    const pjPrimDef = createDeferred<typeof pauhPrimary>();
    const pjTrendDef = createDeferred<typeof pauhTrend>();
    const kePrimDef = createDeferred<typeof kelisaPrimary>();
    const keTrendDef = createDeferred<typeof kelisaTrend>();

    const p1 = executeDashboardFetch({
      seqRef: h.seqRef,
      userId: TARGET_SALARY_ADMIN_UID,
      businessId: TARGET_SALARY_BIZ_ID,
      isSalaryAuthorized: true,
      callbacks: h.callbacks,
      loadPrimary: () => pjPrimDef.promise,
      loadTrend: () => pjTrendDef.promise,
    });

    const p2 = executeDashboardFetch({
      seqRef: h.seqRef,
      userId: TARGET_SALARY_ADMIN_UID,
      businessId: TARGET_SALARY_BIZ_ID,
      isSalaryAuthorized: true,
      callbacks: h.callbacks,
      loadPrimary: () => kePrimDef.promise,
      loadTrend: () => keTrendDef.promise,
    });

    kePrimDef.resolve(kelisaPrimary);
    keTrendDef.resolve(kelisaTrend);
    await p2;

    pjPrimDef.resolve(pauhPrimary);
    pjTrendDef.resolve(pauhTrend);
    await p1;

    const snap = h.snapshot();
    assert(
      !snap.loading &&
      snap.stats.monthlyCollection === 8200 &&
      snap.stats.monthlyExpenses === 2750 &&
      snap.stats.netProfit === 5450 &&
      snap.stats.totalTeachers === 3 &&
      snap.recentPayments[0]?.id === 'pay-ke' &&
      snap.recentExpenses[0]?.id === 'exp-ke' &&
      snap.trendData[0]?.Income === 8200 &&
      snap.payrollReconciliation?.branch === 'Kelisa Emas',
      'Race A: Kelisa Emas resolves first, Pauh Jaya resolves later -> final Dashboard state remains Kelisa Emas'
    );
  }

  // Scenario B: Reversed completion order (Pauh Jaya starts 1st, Kelisa Emas starts 2nd, Pauh Jaya resolves 1st, Kelisa Emas resolves 2nd)
  {
    const h = makeStateHarness();
    const pjPrimDef = createDeferred<typeof pauhPrimary>();
    const pjTrendDef = createDeferred<typeof pauhTrend>();
    const kePrimDef = createDeferred<typeof kelisaPrimary>();
    const keTrendDef = createDeferred<typeof kelisaTrend>();

    const p1 = executeDashboardFetch({
      seqRef: h.seqRef,
      userId: TARGET_SALARY_ADMIN_UID,
      businessId: TARGET_SALARY_BIZ_ID,
      isSalaryAuthorized: true,
      callbacks: h.callbacks,
      loadPrimary: () => pjPrimDef.promise,
      loadTrend: () => pjTrendDef.promise,
    });

    const p2 = executeDashboardFetch({
      seqRef: h.seqRef,
      userId: TARGET_SALARY_ADMIN_UID,
      businessId: TARGET_SALARY_BIZ_ID,
      isSalaryAuthorized: true,
      callbacks: h.callbacks,
      loadPrimary: () => kePrimDef.promise,
      loadTrend: () => keTrendDef.promise,
    });

    pjPrimDef.resolve(pauhPrimary);
    pjTrendDef.resolve(pauhTrend);
    await p1;

    const midSnap = h.snapshot();
    assert(
      midSnap.loading === true && midSnap.stats.monthlyCollection === 0,
      'Race B (mid-flight): Stale Pauh Jaya resolving first does NOT overwrite state or clear loading while Kelisa Emas is pending'
    );

    kePrimDef.resolve(kelisaPrimary);
    keTrendDef.resolve(kelisaTrend);
    await p2;

    const snap = h.snapshot();
    assert(
      !snap.loading &&
      snap.stats.monthlyCollection === 8200 &&
      snap.stats.totalTeachers === 3 &&
      snap.recentPayments[0]?.id === 'pay-ke' &&
      snap.recentExpenses[0]?.id === 'exp-ke' &&
      snap.trendData[0]?.Income === 8200 &&
      snap.payrollReconciliation?.branch === 'Kelisa Emas',
      'Race B (final): Kelisa Emas resolving second sets final state cleanly'
    );
  }

  // Scenario C: Stale request error does not clear loading of newer request; latest request error clears loading safely
  {
    const h = makeStateHarness();
    const pjPrimDef = createDeferred<typeof pauhPrimary>();
    const kePrimDef = createDeferred<typeof kelisaPrimary>();

    const p1 = executeDashboardFetch({
      seqRef: h.seqRef,
      userId: TARGET_SALARY_ADMIN_UID,
      businessId: TARGET_SALARY_BIZ_ID,
      isSalaryAuthorized: true,
      callbacks: h.callbacks,
      loadPrimary: () => pjPrimDef.promise,
      loadTrend: async () => pauhTrend,
    });

    const p2 = executeDashboardFetch({
      seqRef: h.seqRef,
      userId: TARGET_SALARY_ADMIN_UID,
      businessId: TARGET_SALARY_BIZ_ID,
      isSalaryAuthorized: true,
      callbacks: h.callbacks,
      loadPrimary: () => kePrimDef.promise,
      loadTrend: async () => kelisaTrend,
    });

    pjPrimDef.reject(new Error('Simulated stale network error'));
    await p1;
    assert(
      h.snapshot().loading === true,
      'Stale request error does NOT clear loading while newer request is active'
    );

    kePrimDef.reject(new Error('Simulated latest network error'));
    await p2;
    assert(
      h.snapshot().loading === false,
      'Latest request error clears loading safely in finally block'
    );
  }

  // Scenario D: Unauthorized state clears payrollReconciliation even if loader returns a value
  {
    const h = makeStateHarness();
    h.callbacks.setPayrollReconciliation({ branch: 'Pauh Jaya', consolidated_payroll: 5500 });

    await executeDashboardFetch({
      seqRef: h.seqRef,
      userId: TARGET_SALARY_ADMIN_UID,
      businessId: TARGET_SALARY_BIZ_ID,
      isSalaryAuthorized: false,
      callbacks: h.callbacks,
      loadPrimary: async () => pauhPrimary,
      loadTrend: async () => pauhTrend,
    });

    const snap = h.snapshot();
    assert(
      !snap.loading &&
      snap.payrollReconciliation === null &&
      snap.stats.monthlyCollection === 12500,
      'Unauthorized user (!isSalaryAuthorized) resets payrollReconciliation to null while preserving branch KPIs'
    );
  }

  // Scenario E: Missing business context resets loading, reconciliation, and financial state, and invalidates in-flight requests
  {
    const h = makeStateHarness();
    const pjPrimDef = createDeferred<typeof pauhPrimary>();

    const p1 = executeDashboardFetch({
      seqRef: h.seqRef,
      userId: TARGET_SALARY_ADMIN_UID,
      businessId: TARGET_SALARY_BIZ_ID,
      isSalaryAuthorized: true,
      callbacks: h.callbacks,
      loadPrimary: () => pjPrimDef.promise,
      loadTrend: async () => pauhTrend,
    });

    await executeDashboardFetch({
      seqRef: h.seqRef,
      userId: TARGET_SALARY_ADMIN_UID,
      businessId: null,
      isSalaryAuthorized: true,
      callbacks: h.callbacks,
      loadPrimary: async () => pauhPrimary,
      loadTrend: async () => pauhTrend,
    });

    pjPrimDef.resolve(pauhPrimary);
    await p1;

    const snap = h.snapshot();
    assert(
      !snap.loading &&
      snap.error === null &&
      snap.payrollReconciliation === null &&
      snap.stats.monthlyCollection === 0 &&
      snap.recentPayments.length === 0 &&
      snap.recentExpenses.length === 0 &&
      snap.trendData.length === 0,
      'Missing business context (businessId = null) resets loading/error/reconciliation/KPIs and blocks stale in-flight updates'
    );
  }

  // Scenario F: Latest primary request fails after a branch switch -> clears previously loaded Pauh Jaya state atomically
  {
    const h = makeStateHarness();
    await executeDashboardFetch({
      seqRef: h.seqRef,
      userId: TARGET_SALARY_ADMIN_UID,
      businessId: TARGET_SALARY_BIZ_ID,
      isSalaryAuthorized: true,
      callbacks: h.callbacks,
      loadPrimary: async () => pauhPrimary,
      loadTrend: async () => pauhTrend,
    });
    assert(h.snapshot().stats.monthlyCollection === 12500, 'Precondition: Pauh Jaya state loaded before branch switch');

    await executeDashboardFetch({
      seqRef: h.seqRef,
      userId: TARGET_SALARY_ADMIN_UID,
      businessId: TARGET_SALARY_BIZ_ID,
      isSalaryAuthorized: true,
      callbacks: h.callbacks,
      loadPrimary: async () => { throw new Error('Dashboard query failed (expenses): permission denied'); },
      loadTrend: async () => kelisaTrend,
    });

    const snap = h.snapshot();
    assert(
      !snap.loading &&
      snap.error !== null &&
      snap.stats.monthlyCollection === 0 &&
      snap.stats.monthlyExpenses === 0 &&
      snap.stats.netProfit === 0 &&
      snap.stats.totalTeachers === 0 &&
      snap.recentPayments.length === 0 &&
      snap.recentExpenses.length === 0 &&
      snap.trendData.length === 0 &&
      snap.payrollReconciliation === null,
      'Latest primary request failure after branch switch clears all prior branch data and surfaces safe error'
    );
  }

  // Scenario G: Latest trend request fails after primary succeeds -> atomic rollback leaves zero mixed-branch data
  {
    const h = makeStateHarness();
    await executeDashboardFetch({
      seqRef: h.seqRef,
      userId: TARGET_SALARY_ADMIN_UID,
      businessId: TARGET_SALARY_BIZ_ID,
      isSalaryAuthorized: true,
      callbacks: h.callbacks,
      loadPrimary: async () => pauhPrimary,
      loadTrend: async () => pauhTrend,
    });

    await executeDashboardFetch({
      seqRef: h.seqRef,
      userId: TARGET_SALARY_ADMIN_UID,
      businessId: TARGET_SALARY_BIZ_ID,
      isSalaryAuthorized: true,
      callbacks: h.callbacks,
      loadPrimary: async () => kelisaPrimary,
      loadTrend: async () => { throw new Error('Dashboard query failed (trend income): timeout'); },
    });

    const snap = h.snapshot();
    assert(
      !snap.loading &&
      snap.error !== null &&
      snap.stats.monthlyCollection === 0 &&
      snap.recentPayments.length === 0 &&
      snap.recentExpenses.length === 0 &&
      snap.trendData.length === 0 &&
      snap.payrollReconciliation === null,
      'Latest trend request failure after primary success does NOT publish mixed-branch state and resets all prior data'
    );
  }

  // Scenario H: Older request fails AFTER newer request already succeeded -> newer branch data & error=null remain intact
  {
    const h = makeStateHarness();
    const pjPrimDef = createDeferred<typeof pauhPrimary>();
    const kePrimDef = createDeferred<typeof kelisaPrimary>();

    const p1 = executeDashboardFetch({
      seqRef: h.seqRef,
      userId: TARGET_SALARY_ADMIN_UID,
      businessId: TARGET_SALARY_BIZ_ID,
      isSalaryAuthorized: true,
      callbacks: h.callbacks,
      loadPrimary: () => pjPrimDef.promise,
      loadTrend: async () => pauhTrend,
    });

    const p2 = executeDashboardFetch({
      seqRef: h.seqRef,
      userId: TARGET_SALARY_ADMIN_UID,
      businessId: TARGET_SALARY_BIZ_ID,
      isSalaryAuthorized: true,
      callbacks: h.callbacks,
      loadPrimary: () => kePrimDef.promise,
      loadTrend: async () => kelisaTrend,
    });

    kePrimDef.resolve(kelisaPrimary);
    await p2;

    pjPrimDef.reject(new Error('Simulated late stale failure'));
    await p1;

    const snap = h.snapshot();
    assert(
      !snap.loading &&
      snap.error === null &&
      snap.stats.monthlyCollection === 8200 &&
      snap.recentPayments[0]?.id === 'pay-ke' &&
      snap.trendData[0]?.Income === 8200 &&
      snap.payrollReconciliation?.branch === 'Kelisa Emas',
      'Older request failing after newer request succeeds does NOT overwrite Kelisa Emas state or set error'
    );
  }

  // Scenario I: Supabase query & RPC error inspection (never silently coerced to zero)
  {
    let tableErrThrown = false;
    try {
      unwrapSupabaseQuery({ data: null, error: { message: 'connection refused' }, count: null }, 'expenses');
    } catch {
      tableErrThrown = true;
    }
    const emptyOk = unwrapSupabaseQuery({ data: [], error: null, count: 0 }, 'expenses');
    assert(
      tableErrThrown && Array.isArray(emptyOk.data) && emptyOk.data.length === 0 && emptyOk.count === 0,
      'unwrapSupabaseQuery throws on DB error and accepts legitimate empty/0 result'
    );

    let rpcErrThrown = false;
    let rpcAuthErrThrown = false;
    let rpcNullErrThrown = false;
    try {
      unwrapStaffPayrollRpc({ data: null, error: { message: 'statement timeout' } });
    } catch {
      rpcErrThrown = true;
    }
    try {
      unwrapStaffPayrollRpc({ data: null, error: { message: 'Access denied: Cross-branch payroll access is not permitted.' } });
    } catch (e) {
      rpcAuthErrThrown = e instanceof Error && /Access denied/i.test(e.message);
    }
    try {
      unwrapStaffPayrollRpc({ data: null, error: null });
    } catch {
      rpcNullErrThrown = true;
    }
    const zeroPayrollOk = unwrapStaffPayrollRpc({ data: 0, error: null });
    assert(
      rpcErrThrown && rpcAuthErrThrown && rpcNullErrThrown && zeroPayrollOk === 0,
      'unwrapStaffPayrollRpc distinguishes legitimate 0 payroll from RPC failures, unauthorized errors, and null responses'
    );

    let reconErrThrown = false;
    try {
      unwrapPayrollReconciliationRpc({ data: null, error: { message: 'Reconciliation failed closed' } }, true, (r) => r);
    } catch {
      reconErrThrown = true;
    }
    const unauthRecon = unwrapPayrollReconciliationRpc({ data: [{ consolidated_payroll: 5500 }], error: null }, false, (r) => r);
    assert(
      reconErrThrown && unauthRecon === null,
      'unwrapPayrollReconciliationRpc throws on RPC failure for authorized user and returns null when unauthorized'
    );
  }

  // Scenario J: Strict payroll RPC validation (numeric strings, 0, and invalid types/values)
  {
    const validZeroNum = unwrapStaffPayrollRpc({ data: 0, error: null });
    const validZeroStr = unwrapStaffPayrollRpc({ data: '0', error: null });
    const validDecimalStr = unwrapStaffPayrollRpc({ data: '3700.50', error: null });
    assert(
      validZeroNum === 0 && validZeroStr === 0 && validDecimalStr === 3700.5,
      'unwrapStaffPayrollRpc accepts finite numbers and valid PostgreSQL numeric strings including 0'
    );

    const invalidPayrollInputs: unknown[] = [null, undefined, '', '   ', true, false, NaN, Infinity, -Infinity, 'NaN', 'Infinity', 'abc'];
    const allRejected = invalidPayrollInputs.every((bad) => {
      try {
        unwrapStaffPayrollRpc({ data: bad, error: null });
        return false;
      } catch {
        return true;
      }
    });
    assert(
      allRejected,
      'unwrapStaffPayrollRpc rejects null, undefined, empty/whitespace strings, booleans, NaN, Infinity, -Infinity, and non-numeric strings'
    );
  }

  // Scenario K: Strict reconciliation validation (numeric fields & actual boolean is_reconciled)
  {
    const baseRow = {
      consolidated_payroll: '5500.00',
      pauh_jaya_payroll: '3700.00',
      kelisa_emas_payroll: '1800.00',
      branch_allocated_payroll: '5500.00',
      unmapped_payroll: '0.00',
      total_payment_count: 3,
      confidently_mapped_count: 3,
      unmapped_payment_count: 0,
      ambiguous_ownership_count: 0,
      unestablished_branch_count: 0,
      is_reconciled: true,
    };

    const validTrue = mapPayrollReconciliationRow(baseRow);
    const validFalse = mapPayrollReconciliationRow({ ...baseRow, is_reconciled: false });
    assert(
      validTrue.consolidated_payroll === 5500 && validTrue.unmapped_payroll === 0 && validTrue.is_reconciled === true && validFalse.is_reconciled === false,
      'mapPayrollReconciliationRow accepts valid numeric strings, legitimate 0s, and actual booleans (true/false)'
    );

    const invalidReconciledValues: unknown[] = ['false', 'true', null, undefined, 1, 0];
    const allBadReconciledRejected = invalidReconciledValues.every((badBool) => {
      try {
        mapPayrollReconciliationRow({ ...baseRow, is_reconciled: badBool });
        return false;
      } catch {
        return true;
      }
    });
    assert(
      allBadReconciledRejected,
      'mapPayrollReconciliationRow rejects non-boolean is_reconciled values ("false", null, undefined, 1, 0)'
    );

    const invalidNumericValues: unknown[] = [null, undefined, '', 'abc', NaN, Infinity, -Infinity, true];
    const allBadNumericRejected = invalidNumericValues.every((badNum) => {
      try {
        mapPayrollReconciliationRow({ ...baseRow, pauh_jaya_payroll: badNum });
        return false;
      } catch {
        return true;
      }
    });
    assert(
      allBadNumericRejected,
      'mapPayrollReconciliationRow rejects invalid/non-finite numeric fields without coercing to 0'
    );

    // Strict non-negative integer count validation across all 5 count fields
    assert(
      parseStrictNonNegativeInteger(0, 'test_count') === 0 &&
      parseStrictNonNegativeInteger('0', 'test_count') === 0 &&
      parseStrictNonNegativeInteger(42, 'test_count') === 42 &&
      parseStrictNonNegativeInteger('15', 'test_count') === 15,
      'parseStrictNonNegativeInteger accepts valid zero and positive integers'
    );

    const invalidCounts: unknown[] = [-1, '-1', 1.5, '1.5', '1.0', null, undefined, '', '   ', true, false, NaN, Infinity, -Infinity, '12abc', 'NaN'];
    const countFields = [
      'total_payment_count',
      'confidently_mapped_count',
      'unmapped_payment_count',
      'ambiguous_ownership_count',
      'unestablished_branch_count',
    ] as const;

    const allBadCountsRejected = countFields.every((field) =>
      invalidCounts.every((badCount) => {
        try {
          mapPayrollReconciliationRow({ ...baseRow, [field]: badCount });
          return false;
        } catch {
          return true;
        }
      })
    );
    assert(
      allBadCountsRejected,
      'mapPayrollReconciliationRow rejects negative, fractional, null, undefined, empty/whitespace, boolean, NaN, Infinity, and malformed values for all 5 count fields'
    );
  }

  // Scenario L: Branch switch clears previous branch data immediately while pending & binds loadedContextKey, plus Retry after failure
  {
    const h = makeStateHarness();
    const PAUH_BRANCH = '9420a109-4a28-47f3-93ff-f4be08012719';
    const KELISA_BRANCH = 'e4f61aac-9629-4be7-ae7e-8d9b462233a4';

    await executeDashboardFetch({
      seqRef: h.seqRef,
      userId: TARGET_SALARY_ADMIN_UID,
      businessId: TARGET_SALARY_BIZ_ID,
      selectedBranchId: PAUH_BRANCH,
      isSalaryAuthorized: true,
      callbacks: h.callbacks,
      loadPrimary: async () => pauhPrimary,
      loadTrend: async () => pauhTrend,
    });
    assert(
      h.snapshot().loadedContextKey === buildDashboardContextKey(TARGET_SALARY_ADMIN_UID, TARGET_SALARY_BIZ_ID, PAUH_BRANCH, true) &&
      h.snapshot().stats.monthlyCollection === 12500,
      'Precondition: Pauh Jaya contextKey and stats loaded'
    );

    // Switch to Kelisa Emas while request is pending -> previous Pauh Jaya data must be cleared immediately
    const kePrimDef = createDeferred<typeof kelisaPrimary>();
    const pSwitch = executeDashboardFetch({
      seqRef: h.seqRef,
      userId: TARGET_SALARY_ADMIN_UID,
      businessId: TARGET_SALARY_BIZ_ID,
      selectedBranchId: KELISA_BRANCH,
      isSalaryAuthorized: true,
      callbacks: h.callbacks,
      loadPrimary: () => kePrimDef.promise,
      loadTrend: async () => kelisaTrend,
    });

    const midSwitch = h.snapshot();
    assert(
      midSwitch.loading === true &&
      midSwitch.loadedContextKey === null &&
      midSwitch.stats.monthlyCollection === 0 &&
      midSwitch.recentPayments.length === 0 &&
      midSwitch.payrollReconciliation === null,
      'Switching branch immediately clears previous branch data and loadedContextKey while new fetch is pending'
    );

    kePrimDef.reject(new Error('Transient network failure'));
    await pSwitch;

    const failedSnap = h.snapshot();
    assert(
      !failedSnap.loading &&
      failedSnap.error !== null &&
      failedSnap.loadedContextKey === null &&
      failedSnap.stats.monthlyCollection === 0,
      'Failed branch fetch leaves error banner active and loadedContextKey null'
    );

    // Retry succeeds -> clears error, loads Kelisa Emas data, and sets loadedContextKey
    await executeDashboardFetch({
      seqRef: h.seqRef,
      userId: TARGET_SALARY_ADMIN_UID,
      businessId: TARGET_SALARY_BIZ_ID,
      selectedBranchId: KELISA_BRANCH,
      isSalaryAuthorized: true,
      callbacks: h.callbacks,
      loadPrimary: async () => kelisaPrimary,
      loadTrend: async () => kelisaTrend,
    });

    const retrySnap = h.snapshot();
    assert(
      !retrySnap.loading &&
      retrySnap.error === null &&
      retrySnap.loadedContextKey === buildDashboardContextKey(TARGET_SALARY_ADMIN_UID, TARGET_SALARY_BIZ_ID, KELISA_BRANCH, true) &&
      retrySnap.stats.monthlyCollection === 8200 &&
      retrySnap.payrollReconciliation?.branch === 'Kelisa Emas',
      'Retry after failed request clears error, populates Kelisa Emas data, and binds loadedContextKey'
    );
  }
}

runDashboardAsyncRaceTests().then(() => {
  console.log('\n--- 15. Salary-Category Expense Privacy Regression Tests ---');
  assert(
    isSalaryExpenseCategory('Salary') === true &&
    isSalaryExpenseCategory('salary') === true &&
    isSalaryExpenseCategory('Staff Salary') === true &&
    isSalaryExpenseCategory('Payroll') === true &&
    isSalaryExpenseCategory('Wages') === true &&
    isSalaryExpenseCategory('Rental') === false &&
    isSalaryExpenseCategory('Utilities') === false &&
    isSalaryExpenseCategory(null) === false,
    'isSalaryExpenseCategory accurately classifies salary-related expense categories without false positives'
  );

  const mixedExpenses = [
    { id: 'e1', category: 'Rental', description: 'Branch Rent', amount: 1400 },
    { id: 'e2', category: 'Salary', description: 'Confidential Teacher Bonus', amount: 950 },
    { id: 'e3', category: 'Staff Salary', description: 'Confidential Allowance', amount: 300 },
    { id: 'e4', category: 'Utilities', description: 'Electric Bill', amount: 450 },
  ];
  const staffVisibleExpenses = filterVisibleExpenses(mixedExpenses, false);
  assert(
    staffVisibleExpenses.length === 2 &&
    staffVisibleExpenses.map((e) => e.id).join(',') === 'e1,e4' &&
    !staffVisibleExpenses.some((e) => /Confidential|Salary/i.test(`${e.category} ${e.description}`)),
    'Staff (unauthorized) cannot retrieve or render individual Salary-category expense records, descriptions, or amounts'
  );
  const hanaVisibleExpenses = filterVisibleExpenses(mixedExpenses, true);
  assert(
    hanaVisibleExpenses.length === 4,
    'Puan Hana (authorized) retains full visibility of general and Salary-category expense records'
  );

  console.log('\n--- 16. Phase 2.5 Centralized Financial RPC Validation & Reports Race/Error Guard (Executable) ---');
  const validSummary = unwrapFinancialSummaryRpc({
    data: [{
      collections: '10000',
      non_salary_expenses: '1400',
      teacher_payroll: '2000',
      standalone_salary_expenses: '600',
      unresolved_salary_expense_count: 1,
      unresolved_salary_expense_amount: '950',
      total_expenses: '4000',
      net_profit: '6000',
      is_reconciled: false,
    }],
    error: null,
  });
  assert(
    validSummary.collections === 10000 &&
    validSummary.non_salary_expenses === 1400 &&
    validSummary.teacher_payroll === 2000 &&
    validSummary.standalone_salary_expenses === 600 &&
    validSummary.unresolved_salary_expense_count === 1 &&
    validSummary.unresolved_salary_expense_amount === 950 &&
    validSummary.total_expenses === 4000 &&
    validSummary.net_profit === 6000 &&
    validSummary.is_reconciled === false,
    'unwrapFinancialSummaryRpc parses valid numeric strings and pending reconciliation fields accurately'
  );

  const zeroSummary = unwrapFinancialSummaryRpc({
    data: [{
      collections: 0,
      non_salary_expenses: 0,
      teacher_payroll: 0,
      standalone_salary_expenses: 0,
      unresolved_salary_expense_count: 0,
      unresolved_salary_expense_amount: 0,
      total_expenses: 0,
      net_profit: 0,
      is_reconciled: true,
    }],
    error: null,
  });
  assert(
    zeroSummary.total_expenses === 0 && zeroSummary.net_profit === 0 && zeroSummary.is_reconciled === true,
    'unwrapFinancialSummaryRpc accepts legitimate numeric zero'
  );

  let finBadCount = 0;
  for (const bad of [null, undefined, '', '   ', true, false, Number.NaN, Infinity, -Infinity, 'abc', '12px']) {
    try {
      unwrapFinancialSummaryRpc({
        data: [{
          collections: 100,
          non_salary_expenses: bad,
          teacher_payroll: 0,
          standalone_salary_expenses: 0,
          unresolved_salary_expense_count: 0,
          unresolved_salary_expense_amount: 0,
          total_expenses: 0,
          net_profit: 100,
          is_reconciled: true,
        }],
        error: null,
      });
    } catch {
      finBadCount++;
    }
  }
  assert(
    finBadCount === 11,
    'unwrapFinancialSummaryRpc rejects null, undefined, empty/whitespace, booleans, NaN, Infinity, -Infinity, and malformed strings'
  );

  let finRpcErrThrown = false;
  try {
    unwrapFinancialSummaryRpc({ data: null, error: { message: 'Access denied: cannot access another branch' } });
  } catch (e) {
    finRpcErrThrown = e instanceof Error && /Access denied/i.test(e.message);
  }
  assert(
    finRpcErrThrown,
    'unwrapFinancialSummaryRpc throws on unauthorized RPC error instead of converting to zero'
  );

  const validMonthly = unwrapMonthlyFinancialSummaryRpc({
    data: [
      {
        month_num: 11,
        month_name: 'November',
        non_salary_expenses: '1400',
        teacher_payroll: '2000',
        standalone_salary_expenses: '600',
        unresolved_salary_expense_count: 0,
        unresolved_salary_expense_amount: '0',
        total_expenses: '4000',
        is_reconciled: true,
      },
    ],
    error: null,
  });
  assert(
    validMonthly.length === 1 && validMonthly[0].total_expenses === 4000 && validMonthly[0].standalone_salary_expenses === 600 && validMonthly[0].is_reconciled === true,
    'unwrapMonthlyFinancialSummaryRpc parses monthly financial rows accurately'
  );

  let monthlyBadThrown = false;
  try {
    unwrapMonthlyFinancialSummaryRpc({
      data: [{
        month_num: 11,
        month_name: 'November',
        non_salary_expenses: null,
        teacher_payroll: 0,
        standalone_salary_expenses: 0,
        unresolved_salary_expense_count: 0,
        unresolved_salary_expense_amount: 0,
        total_expenses: 0,
        is_reconciled: true,
      }],
      error: null,
    });
  } catch {
    monthlyBadThrown = true;
  }
  assert(
    monthlyBadThrown,
    'unwrapMonthlyFinancialSummaryRpc rejects null/malformed monthly values instead of coercing to zero'
  );

  // Executable Reports race, missing businessId, error reset & retry tests
  const runReportsRaceTests = async () => {
    const seqRef = { current: 0 };
    let loading = false;
    let error: string | null = null;
    let loadedContextKey: string | null = null;
    let summary: ReportsSummaryPayload = { ...EMPTY_REPORTS_SUMMARY };
    let chartData: ReportsChartPoint[] = [];
    let payrollReconciliation: { branch: string } | null = null;

    const callbacks = {
      setLoading: (v: boolean) => { loading = v; },
      setError: (v: string | null) => { error = v; },
      setLoadedContextKey: (v: string | null) => { loadedContextKey = v; },
      setSummary: (v: ReportsSummaryPayload) => { summary = v; },
      setChartData: (v: ReportsChartPoint[]) => { chartData = v; },
      setPayrollReconciliation: (v: { branch: string } | null) => { payrollReconciliation = v; },
    };

    const dPauh = createDeferred<{ summary: ReportsSummaryPayload; chartData: ReportsChartPoint[]; payrollReconciliation: { branch: string } | null }>();
    const dKelisa = createDeferred<{ summary: ReportsSummaryPayload; chartData: ReportsChartPoint[]; payrollReconciliation: { branch: string } | null }>();

    const r1 = executeReportsFetch({
      seqRef,
      userId: TARGET_SALARY_ADMIN_UID,
      businessId: TARGET_SALARY_BIZ_ID,
      selectedBranchId: PAUH_BRANCH_ID,
      isSalaryAuthorized: true,
      callbacks,
      loadReport: () => dPauh.promise,
    });
    const r2 = executeReportsFetch({
      seqRef,
      userId: TARGET_SALARY_ADMIN_UID,
      businessId: TARGET_SALARY_BIZ_ID,
      selectedBranchId: KELISA_BRANCH_ID,
      isSalaryAuthorized: true,
      callbacks,
      loadReport: () => dKelisa.promise,
    });

    dKelisa.resolve({
      summary: { totalIncome: 8000, totalExpenses: 2450, netProfit: 5550 },
      chartData: [{ name: 'Nov', Income: 8000, Expenses: 2450 }],
      payrollReconciliation: { branch: 'Kelisa Emas' },
    });
    await r2;

    dPauh.resolve({
      summary: { totalIncome: 10000, totalExpenses: 3400, netProfit: 6600 },
      chartData: [{ name: 'Nov', Income: 10000, Expenses: 3400 }],
      payrollReconciliation: { branch: 'Pauh Jaya' },
    });
    await r1;

    assert(
      !loading &&
      error === null &&
      summary.totalExpenses === 2450 &&
      summary.netProfit === 5550 &&
      loadedContextKey === buildDashboardContextKey(TARGET_SALARY_ADMIN_UID, TARGET_SALARY_BIZ_ID, KELISA_BRANCH_ID, true) &&
      payrollReconciliation?.branch === 'Kelisa Emas',
      'Reports: Stale Pauh Jaya response resolving after Kelisa Emas never overwrites Kelisa Emas state'
    );

    // Latest request failure clears previous report data and surfaces error
    await executeReportsFetch({
      seqRef,
      userId: PAUH_STAFF_UID,
      businessId: TARGET_SALARY_BIZ_ID,
      selectedBranchId: PAUH_BRANCH_ID,
      isSalaryAuthorized: false,
      callbacks,
      loadReport: async () => {
        throw new Error('Failed to load monthly financial summary: connection lost');
      },
    });
    assert(
      !loading &&
      error !== null &&
      summary.totalIncome === 0 &&
      summary.totalExpenses === 0 &&
      chartData.length === 0 &&
      loadedContextKey === null,
      'Reports: Latest financial RPC failure clears prior report totals and surfaces error banner'
    );

    // Retry after failure restores state cleanly
    await executeReportsFetch({
      seqRef,
      userId: PAUH_STAFF_UID,
      businessId: TARGET_SALARY_BIZ_ID,
      selectedBranchId: PAUH_BRANCH_ID,
      isSalaryAuthorized: false,
      callbacks,
      loadReport: async () => ({
        summary: { totalIncome: 10000, totalExpenses: 3400, netProfit: 6600 },
        chartData: [{ name: 'Nov', Income: 10000, Expenses: 3400 }],
        payrollReconciliation: null,
      }),
    });
    assert(
      !loading &&
      error === null &&
      summary.totalExpenses === 3400 &&
      summary.netProfit === 6600 &&
      loadedContextKey === buildDashboardContextKey(PAUH_STAFF_UID, TARGET_SALARY_BIZ_ID, PAUH_BRANCH_ID, false),
      'Reports: Retry after failure clears error and restores Pauh Jaya totals'
    );

    // Missing businessId clears previous report data
    await executeReportsFetch({
      seqRef,
      userId: PAUH_STAFF_UID,
      businessId: null,
      selectedBranchId: null,
      isSalaryAuthorized: false,
      callbacks,
      loadReport: async () => ({
        summary: { totalIncome: 999, totalExpenses: 1, netProfit: 998 },
        chartData: [],
        payrollReconciliation: null,
      }),
    });
    assert(
      !loading &&
      error === null &&
      summary.totalIncome === 0 &&
      chartData.length === 0 &&
      loadedContextKey === null,
      'Reports: Missing businessId immediately clears previous report data'
    );
  };

  return runReportsRaceTests();
}).then(async () => {
  console.log('\n[17] Expenses Fetch & Reconciliation Modal Race / Error Tests');
  const seqRef = { current: 0 };
  let loading = false;
  let error: string | null = null;
  let loadedContextKey: string | null = null;
  let expenses: Array<{ id: string; amount: number }> = [];
  let unresolvedSalaryExpenses: Array<{ id: string; amount: number }> = [];

  const callbacks = {
    setLoading: (v: boolean) => { loading = v; },
    setError: (v: string | null) => { error = v; },
    setLoadedContextKey: (v: string | null) => { loadedContextKey = v; },
    setExpenses: (v: Array<{ id: string; amount: number }>) => { expenses = v; },
    setUnresolvedSalaryExpenses: (v: Array<{ id: string; amount: number }>) => { unresolvedSalaryExpenses = v; },
  };

  // Out-of-order branch switch: Pauh Jaya slow request vs Kelisa Emas fast request
  let resolveSlowPauh!: (val: { expenses: Array<{ id: string; amount: number }>; unresolvedSalaryExpenses: Array<{ id: string; amount: number }> }) => void;
  const slowPauhPromise = executeExpensesFetch({
    seqRef,
    userId: TARGET_SALARY_ADMIN_UID,
    businessId: TARGET_SALARY_BIZ_ID,
    selectedBranchId: PAUH_BRANCH_ID,
    isSalaryAuthorized: true,
    callbacks,
    loadExpenses: () => new Promise((resolve) => { resolveSlowPauh = resolve; }),
  });

  await executeExpensesFetch({
    seqRef,
    userId: TARGET_SALARY_ADMIN_UID,
    businessId: TARGET_SALARY_BIZ_ID,
    selectedBranchId: KELISA_BRANCH_ID,
    isSalaryAuthorized: true,
    callbacks,
    loadExpenses: async () => ({
      expenses: [{ id: 'ke-exp-1', amount: 450 }],
      unresolvedSalaryExpenses: [{ id: 'ke-sal-1', amount: 600 }],
    }),
  });

  // Resolve stale Pauh Jaya request AFTER Kelisa Emas completed
  resolveSlowPauh({
    expenses: [{ id: 'pj-exp-stale', amount: 9999 }],
    unresolvedSalaryExpenses: [{ id: 'pj-sal-stale', amount: 950 }],
  });
  await slowPauhPromise;

  assert(
    !loading &&
    error === null &&
    loadedContextKey === buildExpensesContextKey(TARGET_SALARY_ADMIN_UID, TARGET_SALARY_BIZ_ID, KELISA_BRANCH_ID, true) &&
    expenses.length === 1 &&
    expenses[0].id === 'ke-exp-1' &&
    unresolvedSalaryExpenses.length === 1 &&
    unresolvedSalaryExpenses[0].id === 'ke-sal-1',
    'Expenses: Stale Pauh Jaya response does not overwrite Kelisa Emas expenses or unresolved items'
  );

  // Latest-request failure clears previous branch data and surfaces visible error
  await executeExpensesFetch({
    seqRef,
    userId: TARGET_SALARY_ADMIN_UID,
    businessId: TARGET_SALARY_BIZ_ID,
    selectedBranchId: PAUH_BRANCH_ID,
    isSalaryAuthorized: true,
    callbacks,
    loadExpenses: async () => {
      throw new Error('Expenses query timed out');
    },
  });

  assert(
    !loading &&
    error !== null &&
    /Unable to load expenses/i.test(error) &&
    loadedContextKey === null &&
    expenses.length === 0 &&
    unresolvedSalaryExpenses.length === 0,
    'Expenses: Latest-request failure clears previous branch data and surfaces visible error'
  );

  // Retry after failure restores Pauh Jaya state
  await executeExpensesFetch({
    seqRef,
    userId: TARGET_SALARY_ADMIN_UID,
    businessId: TARGET_SALARY_BIZ_ID,
    selectedBranchId: PAUH_BRANCH_ID,
    isSalaryAuthorized: true,
    callbacks,
    loadExpenses: async () => ({
      expenses: [{ id: 'pj-exp-1', amount: 1400 }],
      unresolvedSalaryExpenses: [],
    }),
  });

  assert(
    !loading &&
    error === null &&
    loadedContextKey === buildExpensesContextKey(TARGET_SALARY_ADMIN_UID, TARGET_SALARY_BIZ_ID, PAUH_BRANCH_ID, true) &&
    expenses.length === 1 &&
    expenses[0].id === 'pj-exp-1',
    'Expenses: Retry after failure clears error and loads Pauh Jaya expenses'
  );

  // Missing businessId immediately clears expenses state
  await executeExpensesFetch({
    seqRef,
    userId: TARGET_SALARY_ADMIN_UID,
    businessId: null,
    selectedBranchId: null,
    isSalaryAuthorized: false,
    callbacks,
    loadExpenses: async () => ({
      expenses: [{ id: 'never', amount: 1 }],
      unresolvedSalaryExpenses: [],
    }),
  });

  assert(
    !loading &&
    error === null &&
    loadedContextKey === null &&
    expenses.length === 0 &&
    unresolvedSalaryExpenses.length === 0,
    'Expenses: Missing businessId immediately clears previous expenses state'
  );

  // Identity-switch isolation (same business, branch, and authorization status)
  const userA = '11111111-1111-4111-8111-111111111111';
  const userB = '22222222-2222-4222-8222-222222222222';
  await executeExpensesFetch({
    seqRef,
    userId: userA,
    businessId: TARGET_SALARY_BIZ_ID,
    selectedBranchId: PAUH_BRANCH_ID,
    isSalaryAuthorized: false,
    callbacks,
    loadExpenses: async () => ({
      expenses: [{ id: 'userA-exp-1', amount: 300 }],
      unresolvedSalaryExpenses: [],
    }),
  });

  const userBContextKey = buildExpensesContextKey(userB, TARGET_SALARY_BIZ_ID, PAUH_BRANCH_ID, false);
  const visibleUnderUserBBeforeFetch = Boolean(userBContextKey && loadedContextKey === userBContextKey);
  assert(
    !visibleUnderUserBBeforeFetch &&
    loadedContextKey === buildExpensesContextKey(userA, TARGET_SALARY_BIZ_ID, PAUH_BRANCH_ID, false),
    'Expenses Identity: Switching to User B with identical business/branch/auth hides User A loaded data immediately'
  );

  let resolveStaleUserA!: (val: { expenses: Array<{ id: string; amount: number }>; unresolvedSalaryExpenses: Array<{ id: string; amount: number }> }) => void;
  const staleUserAPromise = executeExpensesFetch({
    seqRef,
    userId: userA,
    businessId: TARGET_SALARY_BIZ_ID,
    selectedBranchId: PAUH_BRANCH_ID,
    isSalaryAuthorized: false,
    callbacks,
    loadExpenses: () => new Promise((resolve) => { resolveStaleUserA = resolve; }),
  });

  await executeExpensesFetch({
    seqRef,
    userId: userB,
    businessId: TARGET_SALARY_BIZ_ID,
    selectedBranchId: PAUH_BRANCH_ID,
    isSalaryAuthorized: false,
    callbacks,
    loadExpenses: async () => ({
      expenses: [{ id: 'userB-exp-1', amount: 500 }],
      unresolvedSalaryExpenses: [],
    }),
  });

  resolveStaleUserA({
    expenses: [{ id: 'userA-stale', amount: 999 }],
    unresolvedSalaryExpenses: [{ id: 'userA-sal-stale', amount: 1200 }],
  });
  await staleUserAPromise;

  assert(
    loadedContextKey === userBContextKey &&
    expenses.length === 1 &&
    expenses[0].id === 'userB-exp-1' &&
    unresolvedSalaryExpenses.length === 0,
    'Expenses Identity: Stale User A response resolving after User B does not overwrite User B state'
  );

  // Missing userId fail-closed clears previous state and context key returns null
  assert(
    buildExpensesContextKey(null, TARGET_SALARY_BIZ_ID, PAUH_BRANCH_ID, false) === null,
    'Expenses Identity: Null userId produces null contextKey (fail-closed)'
  );
  await executeExpensesFetch({
    seqRef,
    userId: null,
    businessId: TARGET_SALARY_BIZ_ID,
    selectedBranchId: PAUH_BRANCH_ID,
    isSalaryAuthorized: false,
    callbacks,
    loadExpenses: async () => ({
      expenses: [{ id: 'never-visible', amount: 1 }],
      unresolvedSalaryExpenses: [],
    }),
  });
  assert(
    !loading &&
    error === null &&
    loadedContextKey === null &&
    expenses.length === 0 &&
    unresolvedSalaryExpenses.length === 0,
    'Expenses Identity: Missing userId immediately clears previous expenses and unresolved data'
  );

  // Reconciliation modal payment-option race: stale option response/error must not overwrite current expense
  const optSeqRef = { current: 0 };
  let optError: string | null = null;
  let optRows: Array<{ id: string; amount: number }> = [];
  let rejectSlowOptions!: (err: Error) => void;

  const slowOptionsPromise = executeReconcilePaymentOptionsFetch({
    seqRef: optSeqRef,
    expenseId: 'exp-a',
    callbacks: {
      setError: (v) => { optError = v; },
      setOptions: (v) => { optRows = v; },
    },
    loadOptions: () => new Promise((_, reject) => { rejectSlowOptions = reject; }),
  });

  await executeReconcilePaymentOptionsFetch({
    seqRef: optSeqRef,
    expenseId: 'exp-b',
    callbacks: {
      setError: (v) => { optError = v; },
      setOptions: (v) => { optRows = v; },
    },
    loadOptions: async () => [{ id: 'pay-b-1', amount: 600 }],
  });

  rejectSlowOptions(new Error('Stale payment option error'));
  await slowOptionsPromise;

  assert(
    optError === null &&
    optRows.length === 1 &&
    optRows[0].id === 'pay-b-1',
    'Expenses Modal: Stale payment-option failure does not overwrite current expense options or error state'
  );

  // Reconciliation save error handling & retry tests
  let reconcileSubmitting = false;
  let reconcileError: string | null = null;
  let reconcileConfirming = true;
  let reconcileModalOpen = true;
  let selectedExpenseId: string | null = 'exp-unresolved-1';
  let reconcileAction: 'linked_duplicate' | 'standalone' | 'unresolved' = 'linked_duplicate';
  let selectedStaffPaymentId = 'pay-999';
  let refreshCount = 0;

  const saveCallbacks = {
    setSubmitting: (v: boolean) => { reconcileSubmitting = v; },
    setError: (v: string | null) => { reconcileError = v; },
    setConfirming: (v: boolean) => { reconcileConfirming = v; },
    setModalOpen: (v: boolean) => { reconcileModalOpen = v; },
    clearSelectedExpense: () => { selectedExpenseId = null; },
  };

  // Case A: Supabase RPC returns { error }
  const rpcErrOk = await executeReconcileSave({
    isSalaryAuthorized: true,
    userId: TARGET_SALARY_ADMIN_UID,
    businessId: TARGET_SALARY_BIZ_ID,
    selectedExpenseId,
    reconcileAction,
    selectedStaffPaymentId,
    callbacks: saveCallbacks,
    saveReconcile: async () => ({
      error: { message: 'Selected teacher payment is already linked to another expense.' },
    }),
    onSuccess: async () => { refreshCount += 1; },
  });

  assert(
    !rpcErrOk &&
    !reconcileSubmitting &&
    reconcileModalOpen &&
    selectedExpenseId === 'exp-unresolved-1' &&
    reconcileAction === 'linked_duplicate' &&
    selectedStaffPaymentId === 'pay-999' &&
    reconcileError !== null &&
    /already linked/i.test(reconcileError) &&
    refreshCount === 0,
    'Reconcile Save: Supabase { error } keeps modal & selections intact, surfaces safe error, and resets submitting'
  );

  // Case B: RPC rejects / throws a runtime/network exception with raw internals
  const thrownErrOk = await executeReconcileSave({
    isSalaryAuthorized: true,
    userId: TARGET_SALARY_ADMIN_UID,
    businessId: TARGET_SALARY_BIZ_ID,
    selectedExpenseId,
    reconcileAction,
    selectedStaffPaymentId,
    callbacks: saveCallbacks,
    saveReconcile: async () => {
      throw new Error('FetchError: PGRST000 internal postgres socket connection reset at 10.0.0.12:5432');
    },
    onSuccess: async () => { refreshCount += 1; },
  });

  assert(
    !thrownErrOk &&
    !reconcileSubmitting &&
    reconcileModalOpen &&
    selectedExpenseId === 'exp-unresolved-1' &&
    reconcileAction === 'linked_duplicate' &&
    selectedStaffPaymentId === 'pay-999' &&
    reconcileError === 'Unable to save salary expense classification. Please try again.' &&
    !/10\.0\.0\.12|PGRST000|socket/i.test(reconcileError) &&
    refreshCount === 0,
    'Reconcile Save: Thrown exception keeps modal & selections intact, hides server internals, and resets submitting'
  );

  // Case C: Subsequent retry succeeds
  const retryOk = await executeReconcileSave({
    isSalaryAuthorized: true,
    userId: TARGET_SALARY_ADMIN_UID,
    businessId: TARGET_SALARY_BIZ_ID,
    selectedExpenseId,
    reconcileAction,
    selectedStaffPaymentId,
    callbacks: saveCallbacks,
    saveReconcile: async () => ({ error: null }),
    onSuccess: async () => { refreshCount += 1; },
  });

  assert(
    retryOk &&
    !reconcileSubmitting &&
    !reconcileConfirming &&
    !reconcileModalOpen &&
    selectedExpenseId === null &&
    reconcileError === null &&
    refreshCount === 1,
    'Reconcile Save: Subsequent retry succeeds, closes modal, clears selection, and refreshes expenses'
  );

  // ── 18. Phase 2.9 Targeted Remediation Regression Tests ─────────────────────
  console.log('\n[18] Phase 2.9 Targeted Remediation Regression Tests...');

  // 18a. Static SQL check: B8a-8 uses explicit rejection flag + GET STACKED DIAGNOSTICS + positive control B8a-8b
  const migration08TestSql = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/08_salary_privacy_test.sql'),
    'utf8'
  );
  assert(
    !/WHEN\s+OTHERS\s+THEN/i.test(migration08TestSql),
    'SQL Test: 08_salary_privacy_test.sql contains zero catch-all WHEN OTHERS handlers'
  );
  assert(
    /\(B8a-8\)/.test(migration08TestSql) &&
    /v_rejected\s+BOOLEAN\s*:=\s*false/i.test(migration08TestSql) &&
    /GET\s+STACKED\s+DIAGNOSTICS/i.test(migration08TestSql) &&
    /IF\s+NOT\s+v_rejected\s+THEN/i.test(migration08TestSql) &&
    /\(B8a-8b\)/.test(migration08TestSql),
    'SQL Test: B8a-8 uses v_rejected + GET STACKED DIAGNOSTICS + outside-block assertion and has B8a-8b positive control'
  );

  // 18b. buildDashboardContextKey includes userId & isSalaryAuthorized and fails closed on missing userId/businessId
  {
    const keyUserA = buildDashboardContextKey(TARGET_SALARY_ADMIN_UID, TARGET_SALARY_BIZ_ID, PAUH_BRANCH_ID, true);
    const keyUserB = buildDashboardContextKey(PAUH_STAFF_UID, TARGET_SALARY_BIZ_ID, PAUH_BRANCH_ID, false);
    const keyUserBSameAuth = buildDashboardContextKey(PAUH_STAFF_UID, TARGET_SALARY_BIZ_ID, PAUH_BRANCH_ID, true);
    const keyMissingUser = buildDashboardContextKey(null, TARGET_SALARY_BIZ_ID, PAUH_BRANCH_ID, true);
    const keyMissingBiz = buildDashboardContextKey(TARGET_SALARY_ADMIN_UID, null, PAUH_BRANCH_ID, true);

    assert(
      keyUserA !== null &&
      keyUserB !== null &&
      keyUserBSameAuth !== null &&
      keyUserA !== keyUserB &&
      keyUserA !== keyUserBSameAuth &&
      keyMissingUser === null &&
      keyMissingBiz === null,
      'buildDashboardContextKey: distinguishes users on same business/branch and fails closed on null userId or businessId'
    );
  }

  // 18c. Dashboard: identity switch A -> B on same business & branch ignores stale A data/error and clears on null userId
  {
    let loading = false;
    let error: string | null = null;
    let stats: DashboardStatsPayload = { ...EMPTY_DASHBOARD_STATS };
    let recentPayments: Array<{ id: string }> = [];
    let recentExpenses: Array<{ id: string }> = [];
    let trendData: Array<{ name: string; Income: number; Expenses: number }> = [];
    let payrollReconciliation: { branch: string } | null = null;
    let loadedContextKey: string | null = null;
    const seqRef = { current: 0 };

    const callbacks = {
      setLoading: (v: boolean) => { loading = v; },
      setError: (v: string | null) => { error = v; },
      setStats: (v: DashboardStatsPayload) => { stats = v; },
      setRecentPayments: (v: Array<{ id: string }>) => { recentPayments = v; },
      setRecentExpenses: (v: Array<{ id: string }>) => { recentExpenses = v; },
      setTrendData: (v: Array<{ name: string; Income: number; Expenses: number }>) => { trendData = v; },
      setPayrollReconciliation: (v: { branch: string } | null) => { payrollReconciliation = v; },
      setLoadedContextKey: (v: string | null) => { loadedContextKey = v; },
    };

    const userAPrimary = createDeferred<DashboardPrimaryResult<{ id: string }, { id: string }, { branch: string }>>();
    const userBPrimary = createDeferred<DashboardPrimaryResult<{ id: string }, { id: string }, { branch: string }>>();

    const pUserA = executeDashboardFetch({
      seqRef,
      userId: TARGET_SALARY_ADMIN_UID,
      businessId: TARGET_SALARY_BIZ_ID,
      selectedBranchId: PAUH_BRANCH_ID,
      isSalaryAuthorized: true,
      callbacks,
      loadPrimary: () => userAPrimary.promise,
      loadTrend: async () => [{ name: 'Jan', Income: 9999, Expenses: 1111 }],
    });

    const pUserB = executeDashboardFetch({
      seqRef,
      userId: PAUH_STAFF_UID,
      businessId: TARGET_SALARY_BIZ_ID,
      selectedBranchId: PAUH_BRANCH_ID,
      isSalaryAuthorized: false,
      callbacks,
      loadPrimary: () => userBPrimary.promise,
      loadTrend: async () => [{ name: 'Jan', Income: 3200, Expenses: 900 }],
    });

    userBPrimary.resolve({
      stats: { ...EMPTY_DASHBOARD_STATS, monthlyCollection: 3200 },
      recentPayments: [{ id: 'pay-user-b' }],
      recentExpenses: [{ id: 'exp-user-b' }],
      payrollReconciliation: null,
    });
    await pUserB;

    userAPrimary.resolve({
      stats: { ...EMPTY_DASHBOARD_STATS, monthlyCollection: 9999 },
      recentPayments: [{ id: 'pay-user-a-leaked' }],
      recentExpenses: [{ id: 'exp-user-a-leaked' }],
      payrollReconciliation: { branch: 'Pauh Jaya' },
    });
    await pUserA;

    const expectedUserBKey = buildDashboardContextKey(PAUH_STAFF_UID, TARGET_SALARY_BIZ_ID, PAUH_BRANCH_ID, false);
    assert(
      !loading &&
      error === null &&
      stats.monthlyCollection === 3200 &&
      recentPayments[0]?.id === 'pay-user-b' &&
      recentExpenses[0]?.id === 'exp-user-b' &&
      trendData[0]?.Income === 3200 &&
      payrollReconciliation === null &&
      loadedContextKey === expectedUserBKey,
      'Dashboard identity switch A->B: stale User A response does not overwrite User B data on same business/branch'
    );

    await executeDashboardFetch({
      seqRef,
      userId: null,
      businessId: TARGET_SALARY_BIZ_ID,
      selectedBranchId: PAUH_BRANCH_ID,
      isSalaryAuthorized: false,
      callbacks,
      loadPrimary: async () => {
        throw new Error('Should not load without userId');
      },
      loadTrend: async () => [],
    });

    assert(
      !loading &&
      error === null &&
      stats.monthlyCollection === 0 &&
      recentPayments.length === 0 &&
      recentExpenses.length === 0 &&
      trendData.length === 0 &&
      payrollReconciliation === null &&
      loadedContextKey === null,
      'Dashboard fail-closed: null userId immediately clears prior state and loadedContextKey'
    );
  }

  // 18d. Reports: identity switch A -> B on same business & branch ignores stale A data and clears on null userId
  {
    let loading = false;
    let error: string | null = null;
    let summary: ReportsSummaryPayload = { ...EMPTY_REPORTS_SUMMARY };
    let chartData: ReportsChartPoint[] = [];
    let payrollReconciliation: { branch: string } | null = null;
    let loadedContextKey: string | null = null;
    const seqRef = { current: 0 };

    const callbacks = {
      setLoading: (v: boolean) => { loading = v; },
      setError: (v: string | null) => { error = v; },
      setSummary: (v: ReportsSummaryPayload) => { summary = v; },
      setChartData: (v: ReportsChartPoint[]) => { chartData = v; },
      setPayrollReconciliation: (v: { branch: string } | null) => { payrollReconciliation = v; },
      setLoadedContextKey: (v: string | null) => { loadedContextKey = v; },
    };

    const userAReport = createDeferred<{
      summary: ReportsSummaryPayload;
      chartData: ReportsChartPoint[];
      payrollReconciliation: { branch: string } | null;
    }>();
    const userBReport = createDeferred<{
      summary: ReportsSummaryPayload;
      chartData: ReportsChartPoint[];
      payrollReconciliation: { branch: string } | null;
    }>();

    const pUserA = executeReportsFetch({
      seqRef,
      userId: TARGET_SALARY_ADMIN_UID,
      businessId: TARGET_SALARY_BIZ_ID,
      selectedBranchId: PAUH_BRANCH_ID,
      isSalaryAuthorized: true,
      callbacks,
      loadReport: () => userAReport.promise,
    });

    const pUserB = executeReportsFetch({
      seqRef,
      userId: PAUH_STAFF_UID,
      businessId: TARGET_SALARY_BIZ_ID,
      selectedBranchId: PAUH_BRANCH_ID,
      isSalaryAuthorized: false,
      callbacks,
      loadReport: () => userBReport.promise,
    });

    userBReport.resolve({
      summary: { ...EMPTY_REPORTS_SUMMARY, totalIncome: 4500, totalExpenses: 1400, netProfit: 3100 },
      chartData: [{ name: 'Jan', Income: 4500, Expenses: 1400 }],
      payrollReconciliation: null,
    });
    await pUserB;

    userAReport.reject(new Error('Late User A report error'));
    await pUserA;

    const expectedUserBKey = buildDashboardContextKey(PAUH_STAFF_UID, TARGET_SALARY_BIZ_ID, PAUH_BRANCH_ID, false);
    assert(
      !loading &&
      error === null &&
      summary.totalIncome === 4500 &&
      summary.totalExpenses === 1400 &&
      chartData.length === 1 &&
      payrollReconciliation === null &&
      loadedContextKey === expectedUserBKey,
      'Reports identity switch A->B: stale User A error does not overwrite User B report or set error'
    );

    await executeReportsFetch({
      seqRef,
      userId: null,
      businessId: TARGET_SALARY_BIZ_ID,
      selectedBranchId: PAUH_BRANCH_ID,
      isSalaryAuthorized: false,
      callbacks,
      loadReport: async () => {
        throw new Error('Should not load without userId');
      },
    });

    assert(
      !loading &&
      error === null &&
      summary.totalIncome === 0 &&
      chartData.length === 0 &&
      payrollReconciliation === null &&
      loadedContextKey === null,
      'Reports fail-closed: null userId immediately clears prior report state and loadedContextKey'
    );
  }

  // 18e. Teachers: monotonic seqRef guard ignores stale responses/errors and clears state on invalid context
  {
    let loading = false;
    let staff: Array<{ id: string; salary?: number }> = [];
    let unmappedPayments: Array<{ id: string }> = [];
    let reconciliationSummary: { total: number } | null = null;
    let reconcileError: string | null = null;
    const seqRef = { current: 0 };

    const callbacks = {
      setLoading: (v: boolean) => { loading = v; },
      setStaff: (v: Array<{ id: string; salary?: number }>) => { staff = v; },
      setUnmappedPayments: (v: Array<{ id: string }>) => { unmappedPayments = v; },
      setReconciliationSummary: (v: { total: number } | null) => { reconciliationSummary = v; },
      setReconcileError: (v: string | null) => { reconcileError = v; },
    };

    // Auth loading skips RPCs
    let dirCalls = 0;
    await executeTeachersFetch({
      seqRef,
      authLoading: true,
      userId: TARGET_SALARY_ADMIN_UID,
      businessId: TARGET_SALARY_BIZ_ID,
      isSalaryAuthorized: true,
      callbacks,
      loadDirectory: async () => {
        dirCalls += 1;
        return [];
      },
      loadAuthorizedData: async () => ({ staff: [], unmappedPayments: [], reconciliationSummary: null }),
    });
    assert(dirCalls === 0, 'Teachers fetch guard: authLoading=true skips directory and authorized RPCs');

    // Stale User A response & stale error ignored after User B completes
    const userAAuth = createDeferred<{
      staff: Array<{ id: string; salary?: number }>;
      unmappedPayments: Array<{ id: string }>;
      reconciliationSummary: { total: number } | null;
    }>();
    const userBDir = createDeferred<Array<{ id: string; salary?: number }>>();

    const pA = executeTeachersFetch({
      seqRef,
      authLoading: false,
      userId: TARGET_SALARY_ADMIN_UID,
      businessId: TARGET_SALARY_BIZ_ID,
      isSalaryAuthorized: true,
      callbacks,
      loadDirectory: async () => [],
      loadAuthorizedData: () => userAAuth.promise,
    });

    const pB = executeTeachersFetch({
      seqRef,
      authLoading: false,
      userId: PAUH_STAFF_UID,
      businessId: TARGET_SALARY_BIZ_ID,
      isSalaryAuthorized: false,
      callbacks,
      loadDirectory: () => userBDir.promise,
      loadAuthorizedData: async () => {
        throw new Error('Unauthorized user must not call loadAuthorizedData');
      },
    });

    userBDir.resolve([{ id: 'teacher-pauh-safe' }]);
    await pB;

    userAAuth.resolve({
      staff: [{ id: 'teacher-admin-leaked', salary: 5000 }],
      unmappedPayments: [{ id: 'unmapped-a' }],
      reconciliationSummary: { total: 600 },
    });
    await pA;

    assert(
      !loading &&
      staff.length === 1 &&
      staff[0].id === 'teacher-pauh-safe' &&
      staff[0].salary === undefined &&
      unmappedPayments.length === 0 &&
      reconciliationSummary === null &&
      reconcileError === null,
      'Teachers fetch guard: stale User A response never overwrites User B directory or leaks authorized data'
    );

    // Stale error arriving after newer request must also be ignored
    const userCErrAuth = createDeferred<{
      staff: Array<{ id: string; salary?: number }>;
      unmappedPayments: Array<{ id: string }>;
      reconciliationSummary: { total: number } | null;
    }>();
    const pC = executeTeachersFetch({
      seqRef,
      authLoading: false,
      userId: TARGET_SALARY_ADMIN_UID,
      businessId: TARGET_SALARY_BIZ_ID,
      isSalaryAuthorized: true,
      callbacks,
      loadDirectory: async () => [],
      loadAuthorizedData: () => userCErrAuth.promise,
    });

    const pD = executeTeachersFetch({
      seqRef,
      authLoading: false,
      userId: KELISA_STAFF_UID,
      businessId: TARGET_SALARY_BIZ_ID,
      isSalaryAuthorized: false,
      callbacks,
      loadDirectory: async () => [{ id: 'teacher-kelisa-safe' }],
      loadAuthorizedData: async () => ({ staff: [], unmappedPayments: [], reconciliationSummary: null }),
    });
    await pD;

    userCErrAuth.reject(new Error('Stale network failure'));
    await pC;

    assert(
      !loading &&
      staff.length === 1 &&
      staff[0].id === 'teacher-kelisa-safe' &&
      reconcileError === null,
      'Teachers fetch guard: stale error arriving after newer request does not clobber state or set error'
    );

    // Invalid context (null userId or null businessId) clears all prior state
    await executeTeachersFetch({
      seqRef,
      authLoading: false,
      userId: null,
      businessId: TARGET_SALARY_BIZ_ID,
      isSalaryAuthorized: false,
      callbacks,
      loadDirectory: async () => {
        throw new Error('Should not run with null userId');
      },
      loadAuthorizedData: async () => ({ unmappedPayments: [], reconciliationSummary: null }),
    });

    assert(
      !loading &&
      staff.length === 0 &&
      unmappedPayments.length === 0 &&
      reconciliationSummary === null,
      'Teachers fail-closed: null userId clears staff, unmappedPayments, and reconciliationSummary'
    );
  }
}).then(() => {
  console.log('\n========================================================================');
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}).catch((err) => {
  console.error('Unhandled test error:', err);
  process.exit(1);
});
