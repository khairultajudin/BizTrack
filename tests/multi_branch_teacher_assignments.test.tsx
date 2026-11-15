import React from 'react';
import fs from 'fs';
import path from 'path';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '../src/context/AuthContext';
import { BranchContext } from '../src/context/BranchContext';
import { TemplateContext } from '../src/context/TemplateContext';
import { Teachers, getAssignedBranchIds } from '../src/pages/Teachers';

const TARGET_SALARY_ADMIN_UID = 'd2b660bf-10d3-4d94-94ec-0b8f6e0908e6';
const TARGET_SALARY_BIZ_ID = '978d2b0c-6a2b-4c28-9000-71dc23f96781';
const PAUH_STAFF_UID = '1d602572-2048-4526-bac0-05839ac06471';
const GENERIC_ADMIN_UID = 'a11c9c2b-364d-4aca-b6f1-90e9024c4a6e';
const PAUH_BRANCH_ID = '9420a109-4a28-47f3-93ff-f4be08012719';
const KELISA_BRANCH_ID = 'e4f61aac-9629-4be7-ae7e-8d9b462233a4';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`[PASS] ${label}`);
    passed += 1;
  } else {
    console.error(`[FAIL] ${label}`);
    failed += 1;
  }
}

const defaultTemplate = {
  template: 'tuition',
  settings: {},
  modules: { students: true, classes: true, teachers: true, payments: true, expenses: true, reports: true },
  updateSettings: async () => {},
  toggleModule: async () => {},
  changeTemplate: async () => {},
  t: (key: string) => (key === 'teachers' ? 'Teachers' : key),
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

function renderTeachersPage(userId: string, role: string) {
  const isSalaryAuthorized = userId === TARGET_SALARY_ADMIN_UID;
  const mockAuth = {
    user: { id: userId, email: 'test@biztrack.local' },
    profile: null,
    loading: false,
    displayName: 'Test User',
    initials: 'TU',
    businessId: TARGET_SALARY_BIZ_ID,
    businessName: 'PUSAT TUISYEN AKADEMIK MEGA',
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

// 1. Helper unit tests
assert(
  JSON.stringify(getAssignedBranchIds({ branch_id: PAUH_BRANCH_ID, branch_ids: [PAUH_BRANCH_ID, KELISA_BRANCH_ID] })) ===
    JSON.stringify([PAUH_BRANCH_ID, KELISA_BRANCH_ID]),
  'getAssignedBranchIds prefers branch_ids array for multi-branch teachers'
);

assert(
  JSON.stringify(getAssignedBranchIds({ branch_id: PAUH_BRANCH_ID, branch_ids: [] })) === JSON.stringify([]),
  'getAssignedBranchIds respects explicit empty branch_ids array (unassigned)'
);

assert(
  JSON.stringify(getAssignedBranchIds({ branch_id: PAUH_BRANCH_ID })) === JSON.stringify([PAUH_BRANCH_ID]),
  'getAssignedBranchIds falls back to legacy branch_id when branch_ids is undefined'
);

// 2. Role rendering checks
const hanaHtml = renderTeachersPage(TARGET_SALARY_ADMIN_UID, 'Admin');
assert(hanaHtml.includes('Add Teacher'), 'Puan Hana sees Add Teacher control');
assert(hanaHtml.includes('Manage your staff and instructors.'), 'Puan Hana sees manager subtitle');

const staffHtml = renderTeachersPage(PAUH_STAFF_UID, 'Staff');
assert(!staffHtml.includes('Add Teacher'), 'Branch Staff does not see Add Teacher control');
assert(staffHtml.includes('View your branch teacher directory.'), 'Branch Staff sees directory-only subtitle');

const genericAdminHtml = renderTeachersPage(GENERIC_ADMIN_UID, 'Admin');
assert(!genericAdminHtml.includes('Add Teacher'), 'Generic Admin does not inherit Puan Hana teacher/assignment controls');

// 3. Static source & migration guardrails
const teachersSrc = fs.readFileSync(path.resolve('src/pages/Teachers.tsx'), 'utf8');
assert(teachersSrc.includes('p_branch_ids'), 'Teachers.tsx passes p_branch_ids to save_teacher_with_salary');
assert(teachersSrc.includes('Branch Assignments'), 'Teachers.tsx renders Branch Assignments multi-select checkboxes');
assert(teachersSrc.includes('type="checkbox"'), 'Teachers.tsx uses checkbox controls for multi-branch selection');

const dashboardSrc = fs.readFileSync(path.resolve('src/pages/Dashboard.tsx'), 'utf8');
assert(dashboardSrc.includes("rpc('get_staff_directory'"), 'Dashboard.tsx uses get_staff_directory for multi-branch teacher count');

const reportsSrc = fs.readFileSync(path.resolve('src/pages/Reports.tsx'), 'utf8');
assert(reportsSrc.includes('r.branch_ids.includes(selectedBranchId)'), 'Reports.tsx filters teacher dropdown using branch_ids');

const classesSrc = fs.readFileSync(path.resolve('src/pages/Classes.tsx'), 'utf8');
assert(classesSrc.includes("rpc('get_staff_directory'"), 'Classes.tsx uses get_staff_directory for branch-scoped teacher dropdown');

const m09Sql = fs.readFileSync(path.resolve('supabase/09_multi_branch_teacher_assignments.sql'), 'utf8');
assert(m09Sql.includes('CREATE TABLE IF NOT EXISTS public.staff_branch_assignments'), 'Migration 09 creates staff_branch_assignments table');
assert(m09Sql.includes('UNIQUE (staff_id, branch_id)'), 'Migration 09 prevents duplicate (staff_id, branch_id) assignments');
assert(m09Sql.includes('public.is_salary_authorized(business_id)'), 'Migration 09 enforces Puan Hana UID pinning on assignment writes');
assert(!m09Sql.includes('ea5bd26f-8bba-47a3-845d-bdcc1b57d4ad') || m09Sql.includes('Safety invariant violated'), 'Migration 09 only references protected workspace in invariant check');

const m09Rollback = fs.readFileSync(path.resolve('supabase/09_multi_branch_teacher_assignments_rollback.sql'), 'utf8');
assert(m09Rollback.includes('DROP TABLE IF EXISTS public.staff_branch_assignments'), 'Rollback 09 cleanly drops staff_branch_assignments');

console.log(`\nSUMMARY: ${passed} PASSED, ${failed} FAILED`);
if (failed > 0) process.exit(1);
