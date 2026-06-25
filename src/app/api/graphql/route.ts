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
  CreateWarehouse:  ADMIN,
  // User management
  CreateUserProfile: ADMIN,
  // Tax rate control database
  CreateTaxRate:    ADMIN,
  UpdateTaxRate:    ADMIN,
  // Material catalogue
  CreateMaterialType: ADMIN_MANAGER,
  CreateMaterialSize: ADMIN_MANAGER,
  // Supplier / customer master
  CreateSupplier: ADMIN_MANAGER,
  CreateCustomer: ADMIN_MANAGER,
  // Item master
  CreateItemMaster: ALL_STAFF,
  // Purchase transactions
  CreatePurchaseBill:      ALL_STAFF,
  CreatePurchaseBillItems: ALL_STAFF,
  // Dispatch
  CreateDispatchOrder: ALL_STAFF,
  CreateDispatchItems: ALL_STAFF,
  // Transfers
  CreateTransfer:       ALL_STAFF,
  CreateTransferItems:  ALL_STAFF,
  UpdateTransferStatus: ALL_STAFF,
  // Job work
  CreateJobWorkOrder:       ALL_STAFF,
  CreateJobWorkItems:       ALL_STAFF,
  UpdateJobWorkItem:        ALL_STAFF,
  UpdateJobWorkOrderStatus: ALL_STAFF,
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

  const data = await hasuraFetchEnvelope(body.query, body.variables)
  return NextResponse.json(data, { status: data.errors ? 500 : 200 })
}
