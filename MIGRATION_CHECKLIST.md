# Migration Completion Checklist

Use this checklist to track your progress migrating from Supabase to the new architecture.

## ✅ Completed Tasks

- [x] Docker Compose setup (local development)
- [x] Dockerfiles (Next.js, PostgreSQL)
- [x] Environment configuration
- [x] Hasura GraphQL engine setup
- [x] GraphQL client library (server-side)
- [x] urql setup for client-side queries
- [x] Comprehensive GraphQL queries library
- [x] Updated package.json with GraphQL deps
- [x] Migrated admin page (uses GraphQL)
- [x] Migrated dashboard page (uses GraphQL)
- [x] Documentation (5 guides)
- [x] Setup script (PowerShell)

## 🚀 Phase 1: Local Development Setup

### Prerequisites
- [ ] Docker Desktop installed
- [ ] Docker Compose installed
- [ ] Node.js 20+ installed
- [ ] npm or yarn installed
- [ ] Git repository cloned

### Initial Setup
- [ ] Run `npm install`
- [ ] Run `.\setup.ps1` (or `docker-compose up -d`)
- [ ] Verify containers are running: `docker-compose ps`
- [ ] Access Hasura Console at http://localhost:8080
- [ ] Access Next.js app at http://localhost:3000

### Database & Hasura
- [ ] Verify PostgreSQL is healthy
- [ ] Verify Hasura console is accessible
- [ ] Check that all tables are created
- [ ] Test a simple GraphQL query in Hasura console

## 📄 Phase 2: Admin Pages Migration

### Companies Page
- [ ] Update imports in page.tsx
- [ ] Replace Supabase queries with GraphQL
- [ ] Test page loads without errors
- [ ] Verify data displays correctly
- [ ] Create company form works
- [ ] Update company works
- [ ] Delete company works

### Warehouses Page
- [ ] Update imports in page.tsx
- [ ] Replace Supabase queries with GraphQL
- [ ] Test warehouse list loads
- [ ] Test warehouse creation form
- [ ] Test warehouse update form
- [ ] Relationships (company) display correctly

### Suppliers Page
- [ ] Update imports in page.tsx
- [ ] Replace Supabase queries with GraphQL
- [ ] Test supplier list loads
- [ ] CRUD operations work
- [ ] Search/filtering works

### Customers Page
- [ ] Update imports in page.tsx
- [ ] Replace Supabase queries with GraphQL
- [ ] Test customer list loads
- [ ] CRUD operations work
- [ ] All fields save correctly

### Material Types Page
- [ ] Update imports in page.tsx
- [ ] Replace Supabase queries with GraphQL
- [ ] Test material types list
- [ ] CRUD operations work
- [ ] Unit field saves correctly

### Material Sizes Page
- [ ] Update imports in page.tsx
- [ ] Replace Supabase queries with GraphQL
- [ ] Test material sizes list
- [ ] Test size creation
- [ ] Test material type relationship

### Users Page
- [ ] Update imports in page.tsx
- [ ] Replace Supabase queries with GraphQL
- [ ] Test user profiles list
- [ ] User creation works
- [ ] Role field works correctly
- [ ] Company/warehouse relationships work

## 📊 Phase 3: Business Pages Migration

### Dashboard Page
- [ ] ✅ Already migrated!
- [ ] Verify all stats calculate correctly
- [ ] Company-wise stock groups correctly
- [ ] All icons display

### Purchase Bills Page
- [ ] Update imports
- [ ] Replace Supabase queries with GraphQL
- [ ] Bill list loads and sorts
- [ ] Bill creation form works
- [ ] Bill details page works
- [ ] Relationships (supplier, company) work
- [ ] Total calculations work

### Transfers Page
- [ ] Update imports
- [ ] Replace Supabase queries with GraphQL
- [ ] Transfer list loads
- [ ] Transfer creation works
- [ ] Status field works
- [ ] Warehouse relationships work
- [ ] Transfer details page works

### Job Work Page
- [ ] Update imports
- [ ] Replace Supabase queries with GraphQL
- [ ] Job work list loads
- [ ] Job work creation works
- [ ] Status tracking works
- [ ] Customer relationships work
- [ ] Return functionality works

### Dispatch Orders Page
- [ ] Update imports
- [ ] Replace Supabase queries with GraphQL
- [ ] Dispatch list loads
- [ ] Create dispatch works
- [ ] Date fields work correctly
- [ ] Related data displays

### Inventory Page (if exists)
- [ ] Update imports
- [ ] Replace Supabase queries with GraphQL
- [ ] Inventory view loads
- [ ] Stock levels display
- [ ] Warehouse filtering works

### Reports Page (if exists)
- [ ] Update imports
- [ ] Replace Supabase queries with GraphQL
- [ ] Report generation works
- [ ] Data aggregation works
- [ ] Export functionality works

### Movements Page (if exists)
- [ ] Update imports
- [ ] Replace Supabase queries with GraphQL
- [ ] Movement list loads
- [ ] Filtering works
- [ ] Date range selection works

## 🔐 Phase 4: Authentication

### Current State
- [ ] Note: Currently bypassing auth for development
- [ ] Using Hasura admin secret for all requests

### JWT Implementation (Choose One)

#### Option A: Custom JWT (Recommended)
- [ ] Create authentication endpoint
- [ ] Implement token generation on login
- [ ] Store token in localStorage
- [ ] Pass token in GraphQL headers
- [ ] Implement token refresh logic
- [ ] Add logout functionality

#### Option B: Third-party Auth
- [ ] Choose provider (Auth0, Firebase, etc.)
- [ ] Integrate provider SDK
- [ ] Get JWT tokens from provider
- [ ] Configure Hasura JWT secret
- [ ] Implement login/logout

### Auth Testing
- [ ] Login flow works
- [ ] Token is stored in localStorage
- [ ] GraphQL requests include token
- [ ] Hasura validates token
- [ ] Logout clears token
- [ ] Expired tokens redirect to login
- [ ] Protected pages redirect to login

## 🔧 Phase 5: Form Components

### Admin Forms
- [ ] Update AdminCompanyForm.tsx
- [ ] Update AdminWarehouseForm.tsx
- [ ] Update AdminSupplierForm.tsx
- [ ] Update AdminCustomerForm.tsx
- [ ] Update AdminMaterialForm.tsx
- [ ] Update AdminSizeForm.tsx
- [ ] Update AdminUserInviteForm.tsx

### Business Forms
- [ ] Update Purchase Bill forms
- [ ] Update Transfer forms
- [ ] Update Job Work forms
- [ ] Update Dispatch forms

### Form Features
- [ ] Form validation works
- [ ] Error messages display
- [ ] Loading states show
- [ ] Success notifications appear
- [ ] Form reset works
- [ ] Redirect after submit works
- [ ] Field relationships populate correctly

## 🧪 Phase 6: Testing

### Functionality Tests
- [ ] All pages load without errors
- [ ] All CRUD operations work
- [ ] Relationships display correctly
- [ ] Search/filter features work
- [ ] Pagination works (if implemented)
- [ ] Sorting works (if implemented)
- [ ] Date pickers work
- [ ] Number fields format correctly

### Data Tests
- [ ] Data persists after page refresh
- [ ] Multiple users can access data
- [ ] Data is not accidentally deleted
- [ ] Duplicates are prevented (if needed)
- [ ] Calculations are accurate
- [ ] Timestamps are correct

### Performance Tests
- [ ] Pages load in < 2 seconds
- [ ] GraphQL queries are efficient
- [ ] No N+1 query problems
- [ ] Database queries use indexes
- [ ] Mutations save quickly

### Browser Tests
- [ ] Works in Chrome
- [ ] Works in Firefox
- [ ] Works in Safari
- [ ] Works in Edge
- [ ] Responsive on mobile
- [ ] Responsive on tablet

## 📱 Phase 7: Mobile (Capacitor)

### Build
- [ ] Capacitor installed in project
- [ ] iOS build succeeds
- [ ] Android build succeeds
- [ ] APK/IPA generated

### Testing
- [ ] App loads on iOS device
- [ ] App loads on Android device
- [ ] Can navigate between pages
- [ ] Forms submit successfully
- [ ] API calls work (GraphQL)
- [ ] Offline handling works (if implemented)
- [ ] Camera/permissions work (if used)

### Features
- [ ] All features from web work on mobile
- [ ] Touch gestures work properly
- [ ] Mobile UI looks good
- [ ] No layout issues
- [ ] Back button works correctly

## 🚀 Phase 8: Production Deployment

### Coolify Setup
- [ ] Coolify instance running
- [ ] GitHub repository connected
- [ ] Environment variables configured
- [ ] Secrets stored securely

### Deployment
- [ ] Docker build succeeds
- [ ] Container runs without errors
- [ ] Health checks pass
- [ ] All services start correctly
- [ ] Database migrations run

### Verification
- [ ] App is accessible at domain
- [ ] SSL certificate is valid
- [ ] All pages load
- [ ] API endpoints respond
- [ ] Database is accessible
- [ ] Logs show no errors

### Post-Deployment
- [ ] Automated backups configured
- [ ] Monitoring is set up
- [ ] Error tracking enabled
- [ ] Log aggregation working
- [ ] Alerts are configured

## 🔒 Phase 9: Security

### Code Security
- [ ] Remove hardcoded secrets
- [ ] All env vars are used
- [ ] No debug code in production
- [ ] Dependencies are up-to-date
- [ ] No known vulnerabilities

### Database Security
- [ ] RLS policies are set up
- [ ] User roles are configured
- [ ] Column-level permissions work
- [ ] Sensitive data is protected
- [ ] SQL injection is prevented

### API Security
- [ ] HTTPS enforced
- [ ] CORS configured correctly
- [ ] Rate limiting enabled
- [ ] Input validation works
- [ ] Authentication required

### Backup & Recovery
- [ ] Database backups configured
- [ ] Backup restore tested
- [ ] Disaster recovery plan exists
- [ ] Recovery time objective documented
- [ ] Regular backup verification

## 📊 Phase 10: Monitoring & Optimization

### Monitoring
- [ ] Application monitoring enabled
- [ ] Error tracking set up
- [ ] Performance monitoring enabled
- [ ] Database monitoring enabled
- [ ] Uptime monitoring configured
- [ ] Alerts are working

### Optimization
- [ ] Database indexes added
- [ ] Query performance optimized
- [ ] Cache layer implemented
- [ ] CDN configured (optional)
- [ ] Image optimization done
- [ ] Bundle size optimized

### Documentation
- [ ] API documentation complete
- [ ] Deployment guide written
- [ ] Troubleshooting guide created
- [ ] Team is trained
- [ ] Runbook created

## 📝 Final Checklist

- [ ] All pages migrated to GraphQL
- [ ] All tests pass
- [ ] No console errors
- [ ] No console warnings
- [ ] Code is formatted
- [ ] Documentation is complete
- [ ] Team is trained
- [ ] Deployment is automated
- [ ] Monitoring is active
- [ ] Backups are working

## 🎉 Launch!

- [ ] Schedule maintenance window (if needed)
- [ ] Backup production (if migrating from prod)
- [ ] Deploy to production
- [ ] Verify in production
- [ ] Monitor closely after launch
- [ ] Celebrate! 🎊

---

## Progress Tracking

Update these dates as you complete phases:

- Phase 1 Started: ___________
- Phase 1 Completed: ___________
- Phase 2 Completed: ___________
- Phase 3 Completed: ___________
- Phase 4 Completed: ___________
- Phase 5 Completed: ___________
- Phase 6 Completed: ___________
- Phase 7 Completed: ___________
- Phase 8 Completed: ___________
- Phase 9 Completed: ___________
- Phase 10 Completed: ___________
- 🎉 LAUNCH: ___________

## Notes & Issues

```
[Document any issues encountered and how you resolved them]

Issue 1: _________________________________
Resolution: _______________________________

Issue 2: _________________________________
Resolution: _______________________________
```

---

**Total Pages in App**: ~30+
**Estimated Effort**: 2-4 weeks (depending on team size)
**Estimated Launch**: ___________
