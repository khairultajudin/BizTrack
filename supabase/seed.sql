-- ==========================================
-- BIZTRACK SEED DATA (For Testing)
-- ==========================================
-- This script will insert dummy data into the first Business Workspace it finds.
-- Ensure you have already signed up and created your business before running this!

DO $$ 
DECLARE
  first_business_id uuid;
  teacher_1_id uuid;
  group_1_id uuid;
  student_1_id uuid;
BEGIN
  -- Get the first business in the system
  SELECT id INTO first_business_id FROM public.businesses LIMIT 1;

  IF first_business_id IS NULL THEN
    RAISE NOTICE 'No business found. Please sign up and create a business first via the App Onboarding.';
    RETURN;
  END IF;

  -- Check if data already exists to prevent duplicate seeding
  IF EXISTS (SELECT 1 FROM public.staff WHERE business_id = first_business_id) THEN
    RAISE NOTICE 'Data already seeded for this business.';
    RETURN;
  END IF;

  -- 1. Create Staff (Teachers)
  INSERT INTO public.staff (business_id, name, role, phone, salary_type, salary_amount)
  VALUES 
    (first_business_id, 'Sarah Jenkins', 'Senior Tutor', '+60123456789', 'Monthly', 3500.00),
    (first_business_id, 'Michael Chang', 'Math Tutor', '+60198765432', 'Hourly', 50.00)
  RETURNING id INTO teacher_1_id;

  -- 2. Create Groups (Classes)
  INSERT INTO public.groups (business_id, name, teacher_id, monthly_fee, max_students, status, description)
  VALUES
    (first_business_id, 'Form 4 Advanced Math', teacher_1_id, 150.00, 20, 'Active', 'Intensive math preparation'),
    (first_business_id, 'Form 5 English', NULL, 120.00, 15, 'Active', 'Grammar and essay writing mastery')
  RETURNING id INTO group_1_id;

  -- 3. Create Customers (Students)
  INSERT INTO public.customers (business_id, name, phone, email, assigned_group_id, monthly_fee, status)
  VALUES
    (first_business_id, 'Adam Smith', '+60111111111', 'adam@example.com', group_1_id, 150.00, 'Active'),
    (first_business_id, 'Emma Wong', '+60222222222', 'emma@example.com', group_1_id, 150.00, 'Active'),
    (first_business_id, 'Ali Bin Abu', '+60333333333', 'ali@example.com', NULL, 120.00, 'Active')
  RETURNING id INTO student_1_id;

  -- 4. Create Payments
  INSERT INTO public.payments (business_id, customer_id, month, year, amount, payment_date, payment_method, status)
  VALUES
    (first_business_id, student_1_id, 'July', extract(year from current_date)::int, 150.00, current_date, 'Bank Transfer', 'Paid'),
    (first_business_id, student_1_id, 'June', extract(year from current_date)::int, 150.00, current_date - interval '30 days', 'Cash', 'Paid');

  -- 5. Create Expenses
  INSERT INTO public.expenses (business_id, date, category, description, amount)
  VALUES
    (first_business_id, current_date - interval '5 days', 'Rental', 'Monthly office rent', 2000.00),
    (first_business_id, current_date - interval '2 days', 'Utilities', 'Electricity and Water', 250.00);

  RAISE NOTICE 'Seed data successfully inserted into business ID: %', first_business_id;
END $$;
