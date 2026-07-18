import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraFetchEnvelope } from '@/lib/hasura/transport'

type RoleSet = ReadonlySet<string>

const ADMIN: RoleSet = new Set(['admin', 'developer'])
const ADMIN_MANAGER: RoleSet = new Set(['admin', 'developer', 'company_manager'])
const ALL_STAFF: RoleSet = new Set(['admin', 'developer', 'company_manager', 'billing_staff', 'sales_manager'])

// Mutation operation name → roles permitted to execute it.
// Mutations absent from this map are queries (read-only) and pass through freely.
// Any unknown mutation name is blocked by default to prevent privilege escalation
// from future mutations added without a corresponding permission entry.
const MUTATION_PERMISSIONS: Record<string, RoleSet> = {
  // Company / warehouse setup
  CreateCompany:    ADMIN,
  UpdateCompany:    ADMIN,
  DeleteCompany:    ADMIN,
  CreateWarehouse:  ADMIN,
  UpdateWarehouse:  ADMIN,
  DeleteWarehouse:  ADMIN,
  // User management
  CreateUserProfile: ADMIN,
  // Tax rate control database
  CreateTaxRate:    ADMIN,
  UpdateTaxRate:    ADMIN,
  // Material catalogue
  CreateMaterialType: ADMIN_MANAGER,
  UpdateMaterialType: ADMIN_MANAGER,
  DeleteMaterialType: ADMIN_MANAGER,
  CreateMaterialSize: ADMIN_MANAGER,
  UpdateMaterialSize: ADMIN_MANAGER,
  DeleteMaterialSize: ADMIN_MANAGER,
  // Supplier / customer master
  CreateSupplier: ADMIN_MANAGER,
  UpdateSupplier: ADMIN_MANAGER,
  DeleteSupplier: ADMIN_MANAGER,
  CreateCustomer: ADMIN_MANAGER,
  UpdateCustomer: ADMIN_MANAGER,
  DeleteCustomer: ADMIN_MANAGER,
  // Item master
  CreateItemMaster: ALL_STAFF,
  UpdateItemMaster: ALL_STAFF,
  // Purchase transactions
  CreatePurchaseBill:      ALL_STAFF,
  CreatePurchaseBillItems: ALL_STAFF,
  UpdatePurchaseBill:      ALL_STAFF,
  DeletePurchaseBillItems: ALL_STAFF,
  // Dispatch
  CreateDispatchOrder:       ALL_STAFF,
  CreateDispatchItems:       ALL_STAFF,
  UpdateDispatchOrder:       ALL_STAFF,
  DeleteDispatchItemsByOrder: ALL_STAFF,
  // Transfers
  CreateTransfer:       ALL_STAFF,
  CreateTransferItems:  ALL_STAFF,
  UpdateTransferStatus: ALL_STAFF,
  // Job work
  CreateJobWorkOrder:              ALL_STAFF,
  CreateJobWorkItems:              ALL_STAFF,
  UpdateJobWorkItem:               ALL_STAFF,
  UpdateJobWorkOrderStatus:        ALL_STAFF,
  CreateJobWorkOutputItems:        ALL_STAFF,
  // Job work vendor transfer
  UpdateJobWorkItemTransferredOut: ALL_STAFF,
  CreateJobWorkTransfer:           ALL_STAFF,
  CreateJobWorkTransferItems:      ALL_STAFF,
  // Financial entries
  CreateFinancialEntry: ALL_STAFF,
  // Roles & permissions management
  CreateCustomRole:          ADMIN_MANAGER,
  InsertRolePermissions:     ADMIN_MANAGER,
  UpsertRolePermissions:     ADMIN_MANAGER,
}

// Mutations that record who created the row — the proxy injects `created_by`
// from the verified session so the client can't spoof another user's identity.
const CREATED_BY_MUTATIONS = new Set(['CreatePurchaseBill', 'CreateDispatchOrder'])

// Personal-resource ops: any authenticated user may act on their own rows.
// Ownership is enforced by force-overwriting this variable with the caller's
// session id — Rename/DeleteAiConversation are not domain-privileged actions,
// so they deliberately do NOT go through MUTATION_PERMISSIONS (a custom-role
// user renaming their own chat thread shouldn't need an ALL_STAFF role check).
const SESSION_SCOPED_OPERATIONS: Record<string, string> = {
  GetMyAiConversations: 'owner_id',
  GetAiConversationMessages: 'owner_id',
  RenameAiConversation: 'owner_id',
  DeleteAiConversation: 'owner_id',
}

// Tables sensitive enough to require a whitelisted named query even for reads.
// Queries otherwise pass through unrestricted by name in this app — without
// this check, an anonymous or relabeled query touching these tables would skip
// the owner_id injection above and read any user's conversations.
const GUARDED_QUERY_TABLES = ['ai_conversations', 'ai_messages']

/** Returns the operation type and name from a GraphQL query string. */
function parseOperation(query: string): { type: string; name: string | null } {
  const match = /^\s*(query|mutation|subscription)\s*(\w+)?/i.exec(query ?? '')
  if (!match) return { type: 'query', name: null }
  return { type: match[1].toLowerCase(), name: match[2] ?? null }
}

export async function POST(request: NextRequest) {
  const session = await verifySessionCookie(request)
  if (!session) {
    return NextResponse.json({ errors: [{ message: 'Unauthorized' }] }, { status: 401 })
  }

  const body = await request.json()
  const { type: opType, name: opName } = parseOperation(body.query ?? '')

  if (opType === 'mutation') {
    if (!opName) {
      // Anonymous mutations cannot be authorized — block them.
      return NextResponse.json(
        { errors: [{ message: 'Forbidden: mutation must have a named operation' }] },
        { status: 403 }
      )
    }

    const ownerVar = SESSION_SCOPED_OPERATIONS[opName]
    if (ownerVar) {
      // Ownership-only op — bypass role checks entirely, force the scoping variable.
      body.variables = { ...body.variables, [ownerVar]: session.userId }
    } else {
      const allowedRoles = MUTATION_PERMISSIONS[opName]
      if (!allowedRoles) {
        // Unknown mutation — deny by default to prevent privilege escalation from
        // mutations added in the future without a corresponding permission entry.
        return NextResponse.json(
          { errors: [{ message: 'Forbidden: operation not permitted' }] },
          { status: 403 }
        )
      }

      if (!allowedRoles.has(session.role)) {
        return NextResponse.json(
          { errors: [{ message: 'Forbidden: insufficient permissions' }] },
          { status: 403 }
        )
      }

      // Stamp the creating user server-side — the client cannot be trusted to supply this.
      if (CREATED_BY_MUTATIONS.has(opName)) {
        body.variables = { ...body.variables, created_by: session.userId }
      }
    }
  }

  if (opType === 'query') {
    const ownerVar = opName ? SESSION_SCOPED_OPERATIONS[opName] : undefined
    const touchesGuardedTable = GUARDED_QUERY_TABLES.some((t) => (body.query ?? '').includes(t))
    if (touchesGuardedTable && !ownerVar) {
      return NextResponse.json(
        { errors: [{ message: 'Forbidden: operation not permitted' }] },
        { status: 403 }
      )
    }
    if (ownerVar) {
      body.variables = { ...body.variables, [ownerVar]: session.userId }
    }
  }

  const data = await hasuraFetchEnvelope(body.query, body.variables)
  return NextResponse.json(data, { status: data.errors ? 500 : 200 })
}
