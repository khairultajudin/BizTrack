# BizTrack Database Schema

The database is powered by Supabase (PostgreSQL) and heavily relies on RLS (Row Level Security).

## Core Tables
1. **businesses**: The core tenant table.
2. **profiles**: Extends `auth.users` for user metadata.
3. **business_users**: Maps profiles to businesses with roles (`Creator`, `Admin`, `Staff`, `ReadOnly`).

## Configuration Tables
1. **business_settings**: Stores currency, logo, and brand color.
2. **creator_settings**: Stores the active template and enabled modules (JSON).

## Operational Tables
- **staff**: Teachers, coaches, mechanics.
- **groups**: Classes, sessions, teams.
- **customers**: Students, members, clients. Linked to `groups`.
- **payments**: Incoming collections from customers. Includes status tracking (Paid, Pending).
- **expenses**: Operational outgoing costs.
- **staff_payments**: Salaries and payouts to staff.

## Security (RLS)
Every operational table includes a policy similar to:
```sql
CREATE POLICY "Users can access data in their business" ON public.[table_name]
FOR ALL USING (business_id IN (SELECT public.user_businesses()));
```
This guarantees that data leaking across tenants is mathematically impossible at the database layer.
