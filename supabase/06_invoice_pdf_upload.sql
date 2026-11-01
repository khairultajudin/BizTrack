-- ============================================================
-- BIZTRACK MIGRATION 06: INVOICE PDF UPLOAD & PAYMENTS RLS REMEDIATION
-- ============================================================
-- NOTE: Do NOT execute against production without explicit approval.
-- Pre-deployment check: Run the following query in Supabase SQL Editor first
-- to inspect any manually created policies on public.payments or storage.objects:
--   SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
--   FROM pg_policies
--   WHERE (schemaname = 'public' AND tablename = 'payments')
--      OR (schemaname = 'storage' AND tablename = 'objects');

-- ============================================================
-- 1. ADD NULLABLE invoice_path COLUMN TO public.payments
-- ============================================================
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS invoice_path TEXT DEFAULT NULL;

-- ============================================================
-- 2. ENFORCE SAFE STORAGE PATH FORMAT ON public.payments.invoice_path
--    - Must be NULL or end with .pdf
--    - Must NOT be a permanent http/https URL
--    - Must NOT contain '..' path traversal
--    - First folder segment must match the payment's business_id
--    - Second folder segment must match the payment's id
--    - Scoped by both conname and conrelid for safe idempotency
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'payments_invoice_path_format_check'
      AND conrelid = 'public.payments'::regclass
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_invoice_path_format_check
      CHECK (
        invoice_path IS NULL OR (
          cardinality(string_to_array(invoice_path, '/')) = 3
          AND invoice_path !~* '^https?://'
          AND position('..' in invoice_path) = 0
          AND split_part(invoice_path, '/', 1) = business_id::text
          AND split_part(invoice_path, '/', 2) = id::text
          AND length(split_part(invoice_path, '/', 3)) > 4
          AND split_part(invoice_path, '/', 3) ~* '^[a-z0-9][a-z0-9._-]*\.pdf$'
        )
      );
  END IF;
END $$;

-- ============================================================
-- 3. REMEDIATE public.payments RLS POLICIES (ROLE-BASED ACCESS)
--    Replaces the broad FOR ALL policy ("Users can access data in their business")
--    so ReadOnly users can SELECT payments but cannot INSERT, UPDATE, or DELETE.
-- ============================================================
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Drop legacy broad FOR ALL policy on public.payments
DROP POLICY IF EXISTS "Users can access data in their business" ON public.payments;

-- 3a. SELECT: All legitimate business members (Creator, Admin, Staff, ReadOnly)
DROP POLICY IF EXISTS "Business members can view payments" ON public.payments;
CREATE POLICY "Business members can view payments"
  ON public.payments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = payments.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('Creator', 'Admin', 'Staff', 'ReadOnly')
    )
  );

-- 3b. INSERT: Only write-authorized roles (Creator, Admin, Staff)
DROP POLICY IF EXISTS "Business write users can insert payments" ON public.payments;
CREATE POLICY "Business write users can insert payments"
  ON public.payments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = payments.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('Creator', 'Admin', 'Staff')
    )
  );

-- 3c. UPDATE: Only write-authorized roles (Creator, Admin, Staff) with both USING and WITH CHECK
DROP POLICY IF EXISTS "Business write users can update payments" ON public.payments;
CREATE POLICY "Business write users can update payments"
  ON public.payments
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = payments.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('Creator', 'Admin', 'Staff')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = payments.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('Creator', 'Admin', 'Staff')
    )
  );

-- 3d. DELETE: Only write-authorized roles (Creator, Admin, Staff)
DROP POLICY IF EXISTS "Business write users can delete payments" ON public.payments;
CREATE POLICY "Business write users can delete payments"
  ON public.payments
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id = payments.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('Creator', 'Admin', 'Staff')
    )
  );

-- ============================================================
-- 4. CREATE PRIVATE 'invoices' BUCKET IN SUPABASE STORAGE
--    - public = false (private bucket, short-lived signed URLs required)
--    - file_size_limit = 5242880 (5 MB)
--    - allowed_mime_types = ['application/pdf']
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'invoices',
  'invoices',
  false,
  5242880,
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['application/pdf'];

-- ============================================================
-- 5. STORAGE RLS POLICIES FOR 'invoices' BUCKET
--    Path convention: {business_id}/{payment_id}/{unique_filename}.pdf
--    Enforces both business membership/role AND payment ownership.
-- ============================================================

-- 5a. SELECT: Authenticated business members (Creator, Admin, Staff, ReadOnly)
--             can access invoices belonging to an existing payment in their business
DROP POLICY IF EXISTS "Business users can view their business invoices" ON storage.objects;
CREATE POLICY "Business users can view their business invoices"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'invoices'
    AND array_length(storage.foldername(name), 1) = 2
    AND EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id::text = (storage.foldername(name))[1]
        AND bu.user_id = auth.uid()
        AND bu.role IN ('Creator', 'Admin', 'Staff', 'ReadOnly')
    )
    AND EXISTS (
      SELECT 1
      FROM public.payments p
      WHERE p.id::text = (storage.foldername(name))[2]
        AND p.business_id::text = (storage.foldername(name))[1]
    )
  );

-- 5b. INSERT: Authenticated write users (Creator, Admin, Staff) can upload PDF files
--             ONLY into a folder matching an existing payment ID belonging to their business
DROP POLICY IF EXISTS "Business write users can upload business invoices" ON storage.objects;
CREATE POLICY "Business write users can upload business invoices"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'invoices'
    AND LOWER(storage.extension(name)) = 'pdf'
    AND array_length(storage.foldername(name), 1) = 2
    AND EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id::text = (storage.foldername(name))[1]
        AND bu.user_id = auth.uid()
        AND bu.role IN ('Creator', 'Admin', 'Staff')
    )
    AND EXISTS (
      SELECT 1
      FROM public.payments p
      WHERE p.id::text = (storage.foldername(name))[2]
        AND p.business_id::text = (storage.foldername(name))[1]
    )
  );

-- 5c. UPDATE: Authenticated write users (Creator, Admin, Staff) can update/replace PDF files
--             ONLY for an existing payment ID belonging to their business
DROP POLICY IF EXISTS "Business write users can update business invoices" ON storage.objects;
CREATE POLICY "Business write users can update business invoices"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'invoices'
    AND array_length(storage.foldername(name), 1) = 2
    AND EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id::text = (storage.foldername(name))[1]
        AND bu.user_id = auth.uid()
        AND bu.role IN ('Creator', 'Admin', 'Staff')
    )
    AND EXISTS (
      SELECT 1
      FROM public.payments p
      WHERE p.id::text = (storage.foldername(name))[2]
        AND p.business_id::text = (storage.foldername(name))[1]
    )
  )
  WITH CHECK (
    bucket_id = 'invoices'
    AND LOWER(storage.extension(name)) = 'pdf'
    AND array_length(storage.foldername(name), 1) = 2
    AND EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id::text = (storage.foldername(name))[1]
        AND bu.user_id = auth.uid()
        AND bu.role IN ('Creator', 'Admin', 'Staff')
    )
    AND EXISTS (
      SELECT 1
      FROM public.payments p
      WHERE p.id::text = (storage.foldername(name))[2]
        AND p.business_id::text = (storage.foldername(name))[1]
    )
  );

-- 5d. DELETE: Authenticated write users (Creator, Admin, Staff) can delete invoice files
--             in their business folder (supports both direct removal and post-cascade cleanup)
DROP POLICY IF EXISTS "Business write users can delete business invoices" ON storage.objects;
CREATE POLICY "Business write users can delete business invoices"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'invoices'
    AND array_length(storage.foldername(name), 1) = 2
    AND EXISTS (
      SELECT 1
      FROM public.business_users bu
      WHERE bu.business_id::text = (storage.foldername(name))[1]
        AND bu.user_id = auth.uid()
        AND bu.role IN ('Creator', 'Admin', 'Staff')
    )
  );
