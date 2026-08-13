# BizTrack Seed Data Guide

To rapidly test BizTrack's dashboard and operational modules without manually creating dozens of records, you can execute the seed script.

## Pre-requisites
You **must** sign up and complete the Onboarding flow first. The seed script is designed to securely identify your active business workspace and inject data specifically into it.

## Execution
1. Open the Supabase Dashboard for your project.
2. Navigate to the **SQL Editor**.
3. Copy the contents of `supabase/seed.sql`.
4. Paste and Run the script.

## What it generates
- 2 Teachers (Staff)
- 2 Classes (Groups)
- 3 Students (Customers)
- 2 Payments (one Paid, one Pending)
- 2 Expenses

The script is idempotent for the same business, meaning it will abort if it detects existing staff data to prevent duplicates.
