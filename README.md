# BizTrack Setup Instructions

Welcome to BizTrack! Follow these instructions to get your local environment running.

## 1. Supabase Backend Setup

BizTrack requires a Supabase backend for authentication and data storage.

1. Go to your [Supabase Dashboard](https://supabase.com/dashboard) and create a new project.
2. Once the project is ready, navigate to the **SQL Editor** on the sidebar.
3. Open the file `supabase/schema.sql` located in this repository.
4. Copy the entire contents of the file, paste it into the SQL Editor in Supabase, and click **Run**. This will create all the necessary multi-tenant tables and Row Level Security (RLS) policies.

## 2. Environment Variables

You need to connect your frontend application to your newly created Supabase project.

1. In your Supabase Dashboard, navigate to **Project Settings** > **API**.
2. Locate your **Project URL** and your **Publishable Key** (formerly known as the `anon` key).
3. Open the `.env` file in the root of the `BizTrack` directory.
4. Replace the placeholder values with your actual URL and Publishable Key:

```env
VITE_SUPABASE_URL=https://<your-project-id>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-publishable-key>
```

## 3. Running the Application

Once your `.env` is configured, you can start the application:

```bash
# Install dependencies (if you haven't already)
npm install

# Start the development server
npm run dev
```

The application will be available at `http://localhost:5173`. 
Note: Since we enforce authentication immediately, you will be redirected to the Login page. You can create your first user directly via the Supabase Auth dashboard or by adding a sign-up flow later.
