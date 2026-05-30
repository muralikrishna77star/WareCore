// ─── Master Data Queries ────────────────────────────────────────────────────

export const COMPANIES_QUERY = `
  query GetCompanies {
    companies(order_by: {name: asc}) {
      id
      name
      code
      short_name
      address
      city
      state
      pincode
      phone
      email
      gstin
      is_active
      created_at
      updated_at
    }
  }
`

export const WAREHOUSES_QUERY = `
  query GetWarehouses {
    warehouses(order_by: {name: asc}) {
      id
      company_id
      name
      address
      city
      state
      is_active
      created_at
      updated_at
      companies {
        id
        name
      }
    }
  }
`

export const SUPPLIERS_QUERY = `
  query GetSuppliers {
    suppliers(order_by: {name: asc}) {
      id
      name
      contact_person
      phone
      email
      address
      city
      state
      pincode
      gstin
      is_active
      created_at
      updated_at
    }
  }
`

export const CUSTOMERS_QUERY = `
  query GetCustomers {
    customers(order_by: {name: asc}) {
      id
      name
      contact_person
      phone
      email
      address
      city
      state
      pincode
      gstin
      is_active
      created_at
      updated_at
    }
  }
`

export const MATERIAL_TYPES_QUERY = `
  query GetMaterialTypes {
    material_types(order_by: {name: asc}) {
      id
      name
      unit
      description
      is_active
      created_at
    }
  }
`

export const MATERIAL_SIZES_QUERY = `
  query GetMaterialSizes {
    material_sizes(order_by: {size_label: asc}) {
      id
      material_type_id
      size_label
      thickness
      width
      is_active
      created_at
      material_types {
        id
        name
      }
    }
  }
`

export const ITEM_GROUPS_QUERY = `
  query GetItemGroups {
    item_groups(order_by: {group_code: asc}) {
      id
      group_code
      group_desc
      is_active
      created_at
      updated_at
    }
  }
`

export const ACTIVE_ITEM_GROUPS_QUERY = `
  query GetActiveItemGroups {
    item_groups(where: {is_active: {_eq: true}}, order_by: {group_code: asc}) {
      id
      group_code
      group_desc
      is_active
      created_at
      updated_at
    }
  }
`

export const USER_PROFILES_QUERY = `
  query GetUserProfiles {
    user_profiles(order_by: {full_name: asc}) {
      id
      full_name
      role
      company_id
      warehouse_id
      phone
      is_active
      created_at
      updated_at
      companies {
        id
        name
      }
      warehouses {
        id
        name
      }
    }
  }
`

export const DASHBOARD_STATS_QUERY = `
  query GetDashboardStats {
    v_current_stock {
      company_id
      company_name
      company_code
      current_stock
    }
    purchase_bills_aggregate {
      aggregate {
        count
      }
    }
    transfers_aggregate(where: {status: {_eq: "pending"}}) {
      aggregate {
        count
      }
    }
    job_work_orders_aggregate(where: {status: {_in: ["dispatched", "partial_return"]}}) {
      aggregate {
        count
      }
    }
    dispatch_orders_aggregate {
      aggregate {
        count
      }
    }
  }
`

export const CREATE_COMPANY_MUTATION = `
  mutation CreateCompany($name: String!, $code: String!, $short_name: String, $address: String, $city: String, $state: String, $pincode: String, $phone: String, $email: String, $gstin: String) {
    insert_companies_one(object: {
      name: $name
      code: $code
      short_name: $short_name
      address: $address
      city: $city
      state: $state
      pincode: $pincode
      phone: $phone
      email: $email
      gstin: $gstin
    }) {
      id
      name
      code
    }
  }
`

export const UPDATE_COMPANY_MUTATION = `
  mutation UpdateCompany($id: uuid!, $name: String!, $code: String!, $short_name: String, $address: String, $city: String, $state: String, $pincode: String, $phone: String, $email: String, $gstin: String, $is_active: Boolean) {
    update_companies_by_pk(pk_columns: {id: $id}, _set: {
      name: $name
      code: $code
      short_name: $short_name
      address: $address
      city: $city
      state: $state
      pincode: $pincode
      phone: $phone
      email: $email
      gstin: $gstin
      is_active: $is_active
    }) {
      id
      name
    }
  }
`

export const CREATE_WAREHOUSE_MUTATION = `
  mutation CreateWarehouse($company_id: uuid!, $name: String!, $address: String, $city: String, $state: String) {
    insert_warehouses_one(object: {
      company_id: $company_id
      name: $name
      address: $address
      city: $city
      state: $state
    }) {
      id
      name
    }
  }
`

export const CREATE_SUPPLIER_MUTATION = `
  mutation CreateSupplier($name: String!, $contact_person: String, $phone: String, $email: String, $address: String, $city: String, $state: String, $pincode: String, $gstin: String) {
    insert_suppliers_one(object: {
      name: $name
      contact_person: $contact_person
      phone: $phone
      email: $email
      address: $address
      city: $city
      state: $state
      pincode: $pincode
      gstin: $gstin
    }) {
      id
      name
    }
  }
`

export const CREATE_CUSTOMER_MUTATION = `
  mutation CreateCustomer($name: String!, $contact_person: String, $phone: String, $email: String, $address: String, $city: String, $state: String, $pincode: String, $gstin: String) {
    insert_customers_one(object: {
      name: $name
      contact_person: $contact_person
      phone: $phone
      email: $email
      address: $address
      city: $city
      state: $state
      pincode: $pincode
      gstin: $gstin
    }) {
      id
      name
    }
  }
`

export const CREATE_USER_PROFILE_MUTATION = `
  mutation CreateUserProfile($id: uuid!, $email: String!, $password_hash: String!, $full_name: String!, $role: String!, $company_id: uuid, $warehouse_id: uuid) {
    insert_user_profiles_one(object: {
      id: $id
      email: $email
      password_hash: $password_hash
      full_name: $full_name
      role: $role
      company_id: $company_id
      warehouse_id: $warehouse_id
    }) {
      id
      full_name
    }
  }
`

export const CREATE_PURCHASE_BILL_MUTATION = `
  mutation CreatePurchaseBill($supplier_id: uuid, $company_id: uuid, $warehouse_id: uuid, $bill_number: String!, $bill_date: date!, $total_quantity: numeric, $total_amount: numeric, $notes: String) {
    insert_purchase_bills_one(object: {
      supplier_id: $supplier_id
      company_id: $company_id
      warehouse_id: $warehouse_id
      bill_number: $bill_number
      bill_date: $bill_date
      total_quantity: $total_quantity
      total_amount: $total_amount
      notes: $notes
    }) {
      id
      bill_number
    }
  }
`

// ─── Active (filtered) lookup queries for forms ─────────────────────────────

export const ACTIVE_COMPANIES_QUERY = `
  query GetActiveCompanies {
    companies(where: {is_active: {_eq: true}}, order_by: {name: asc}) {
      id name code short_name
    }
  }
`

export const ACTIVE_WAREHOUSES_QUERY = `
  query GetActiveWarehouses {
    warehouses(where: {is_active: {_eq: true}}, order_by: {name: asc}) {
      id name company_id
    }
  }
`

export const ACTIVE_SUPPLIERS_QUERY = `
  query GetActiveSuppliers {
    suppliers(where: {is_active: {_eq: true}}, order_by: {name: asc}) {
      id name
    }
  }
`

export const ACTIVE_CUSTOMERS_QUERY = `
  query GetActiveCustomers {
    customers(where: {is_active: {_eq: true}}, order_by: {name: asc}) {
      id name
    }
  }
`

export const ACTIVE_MATERIAL_TYPES_QUERY = `
  query GetActiveMaterialTypes {
    material_types(where: {is_active: {_eq: true}}, order_by: {name: asc}) {
      id name unit
    }
  }
`

export const ACTIVE_MATERIAL_SIZES_QUERY = `
  query GetActiveMaterialSizes {
    material_sizes(where: {is_active: {_eq: true}}, order_by: {size_label: asc}) {
      id material_type_id size_label thickness width
    }
  }
`

export const ACTIVE_ITEM_MASTER_QUERY = `
  query GetActiveItemMaster {
    item_master(where: {is_active: {_eq: true}}, order_by: {item_name: asc}) {
      id
      item_code
      item_name
      item_group_id
      material_type_id
      material_size_id
      size_label
      unit
      is_active
      created_at
      item_groups {
        id
        group_code
        group_desc
      }
      material_types { name }
      material_sizes { id size_label }
    }
  }
`

export const ITEM_MASTER_BY_MATERIAL_TYPE_QUERY = `
  query GetItemMasterByMaterialType($material_type_id: uuid!) {
    item_master(where: {material_type_id: {_eq: $material_type_id}, is_active: {_eq: true}}, order_by: {item_name: asc}) {
      id
      item_code
      item_name
      item_group_id
      material_type_id
      material_size_id
      size_label
      unit
      is_active
      created_at
      item_groups {
        id
        group_code
      }
      material_types { name }
      material_sizes { id size_label }
    }
  }
`

export const CREATE_ITEM_MASTER_MUTATION = `
  mutation CreateItemMaster($item_code: String!, $item_name: String!, $item_group_id: uuid!, $material_type_id: uuid!, $material_size_id: uuid, $size_label: String, $unit: String, $description: String) {
    insert_item_master_one(object: {
      item_code: $item_code
      item_name: $item_name
      item_group_id: $item_group_id
      material_type_id: $material_type_id
      material_size_id: $material_size_id
      size_label: $size_label
      unit: $unit
      description: $description
    }) {
      id
      item_code
      item_name
      item_group_id
      material_size_id
      size_label
    }
  }
`

export const ITEM_MASTERS_QUERY = `
  query GetItemMasters {
    item_master(order_by: {item_code: asc}) {
      id
      item_code
      item_name
      item_group_id
      material_type_id
      material_size_id
      size_label
      unit
      is_active
      item_groups {
        id
        group_code
        group_desc
      }
      material_types {
        id
        name
      }
      material_sizes {
        id
        size_label
      }
    }
  }
`

// ─── Purchase Bills ──────────────────────────────────────────────────────────

export const PURCHASE_BILLS_QUERY = `
  query GetPurchaseBills {
    purchase_bills(order_by: {bill_date: desc}, limit: 50) {
      id bill_number bill_date total_quantity total_amount notes created_at
      companies { id name code }
      warehouses { id name }
      suppliers { id name }
    }
  }
`

export const PURCHASE_BILL_BY_ID_QUERY = `
  query GetPurchaseBillById($id: uuid!) {
    purchase_bills_by_pk(id: $id) {
      id bill_number bill_date total_quantity total_amount notes created_at
      companies { name }
      warehouses { name }
      suppliers { name }
    }
  }
`

export const PURCHASE_BILL_ITEMS_QUERY = `
  query GetPurchaseBillItems($bill_id: uuid!) {
    purchase_bill_items(where: {bill_id: {_eq: $bill_id}}, order_by: {id: asc}) {
      id bill_id quantity rate amount notes size_label item_name purchase_line_id
      material_types { name }
      material_sizes { size_label }
    }
  }
`

export const CREATE_PURCHASE_BILL_ITEMS_MUTATION = `
  mutation CreatePurchaseBillItems($objects: [purchase_bill_items_insert_input!]!) {
    insert_purchase_bill_items(objects: $objects) {
      affected_rows
      returning { 
        id 
        purchase_line_id
        item_name 
        material_types { name } 
      }
    }
  }
`

// ─── Material Management ─────────────────────────────────────────────────────

export const CREATE_MATERIAL_TYPE_MUTATION = `
  mutation CreateMaterialType($name: String!, $unit: String, $description: String) {
    insert_material_types_one(object: {
      name: $name
      unit: $unit
      description: $description
    }) {
      id name unit
    }
  }
`

export const CREATE_MATERIAL_SIZE_MUTATION = `
  mutation CreateMaterialSize($material_type_id: uuid!, $size_label: String!, $thickness: numeric, $width: numeric) {
    insert_material_sizes_one(object: {
      material_type_id: $material_type_id
      size_label: $size_label
      thickness: $thickness
      width: $width
    }) {
      id material_type_id size_label thickness width
    }
  }
`

export const CREATE_ITEM_GROUP_MUTATION = `
  mutation CreateItemGroup($group_code: String!, $group_desc: String) {
    insert_item_groups_one(object: {
      group_code: $group_code
      group_desc: $group_desc
    }) {
      id
      group_code
      group_desc
    }
  }
`

// ─── Transfers ───────────────────────────────────────────────────────────────

export const TRANSFERS_QUERY = `
  query GetTransfers {
    transfers(order_by: {transfer_date: desc}, limit: 50) {
      id transfer_date status notes created_at
      from_company: companies_from { name code }
      to_company: companies_to { name code }
      from_warehouse: warehouses_from { name }
      to_warehouse: warehouses_to { name }
      transfer_items {
        quantity size_label
        material_types { name }
        material_sizes { size_label }
      }
    }
  }
`

export const TRANSFER_BY_ID_QUERY = `
  query GetTransferById($id: uuid!) {
    transfers_by_pk(id: $id) {
      id transfer_date status notes created_at updated_at
      from_company: companies_from { name }
      to_company: companies_to { name }
      from_warehouse: warehouses_from { name }
      to_warehouse: warehouses_to { name }
    }
  }
`

export const TRANSFER_ITEMS_QUERY = `
  query GetTransferItems($transfer_id: uuid!) {
    transfer_items(where: {transfer_id: {_eq: $transfer_id}}, order_by: {id: asc}) {
      id transfer_id quantity notes size_label
      material_types { name }
      material_sizes { size_label }
    }
  }
`

export const CREATE_TRANSFER_MUTATION = `
  mutation CreateTransfer($from_company_id: uuid, $to_company_id: uuid, $from_warehouse_id: uuid, $to_warehouse_id: uuid, $transfer_date: date!, $status: String!, $notes: String) {
    insert_transfers_one(object: {
      from_company_id: $from_company_id
      to_company_id: $to_company_id
      from_warehouse_id: $from_warehouse_id
      to_warehouse_id: $to_warehouse_id
      transfer_date: $transfer_date
      status: $status
      notes: $notes
    }) { id }
  }
`

export const CREATE_TRANSFER_ITEMS_MUTATION = `
  mutation CreateTransferItems($objects: [transfer_items_insert_input!]!) {
    insert_transfer_items(objects: $objects) { affected_rows }
  }
`

export const UPDATE_TRANSFER_STATUS_MUTATION = `
  mutation UpdateTransferStatus($id: uuid!, $status: String!, $updated_at: timestamptz!) {
    update_transfers_by_pk(pk_columns: {id: $id}, _set: {status: $status, updated_at: $updated_at}) {
      id status
    }
  }
`

// ─── Dispatch Orders ─────────────────────────────────────────────────────────

export const DISPATCH_ORDERS_QUERY = `
  query GetDispatchOrders {
    dispatch_orders(order_by: {dispatch_date: desc}, limit: 50) {
      id dispatch_date vehicle_number driver_name notes created_at
      companies { name code }
      customers { name }
      dispatch_items {
        quantity amount
      }
    }
  }
`

export const DISPATCH_ORDER_BY_ID_QUERY = `
  query GetDispatchOrderById($id: uuid!) {
    dispatch_orders_by_pk(id: $id) {
      id dispatch_date vehicle_number driver_name notes created_at
      invoice_number
      companies { name }
      warehouses { name }
      customers { name }
    }
  }
`

export const DISPATCH_ITEMS_QUERY = `
  query GetDispatchItems($dispatch_order_id: uuid!) {
    dispatch_items(where: {dispatch_order_id: {_eq: $dispatch_order_id}}, order_by: {id: asc}) {
      id dispatch_order_id purchase_line_id sub_purchase_line_id quantity rate amount notes size_label
      material_types { name }
      material_sizes { size_label }
    }
  }
`

export const PURCHASE_LINE_STOCK_QUERY = `
  query GetPurchaseLineStock($purchase_line_id: String!) {
    stock_ledger_aggregate(where: {purchase_line_id: {_eq: $purchase_line_id}}) {
      aggregate {
        sum {
          quantity
        }
      }
    }
  }
`

export const CREATE_DISPATCH_ORDER_MUTATION = `
  mutation CreateDispatchOrder($company_id: uuid, $warehouse_id: uuid, $customer_id: uuid, $invoice_number: String, $dispatch_date: date!, $vehicle_number: String, $driver_name: String, $total_quantity: numeric, $total_amount: numeric, $notes: String) {
    insert_dispatch_orders_one(object: {
      company_id: $company_id
      warehouse_id: $warehouse_id
      customer_id: $customer_id
      invoice_number: $invoice_number
      dispatch_date: $dispatch_date
      vehicle_number: $vehicle_number
      driver_name: $driver_name
      total_quantity: $total_quantity
      total_amount: $total_amount
      notes: $notes
    }) { id }
  }
`

export const CREATE_DISPATCH_ITEMS_MUTATION = `
  mutation CreateDispatchItems($objects: [dispatch_items_insert_input!]!) {
    insert_dispatch_items(objects: $objects) { affected_rows }
  }
`
export const FINANCIAL_ENTRIES_QUERY = `
  query GetFinancialEntries {
    financial_entries(order_by: {entry_date: desc, created_at: desc}, limit: 100) {
      id
      company_id
      supplier_id
      customer_id
      entry_type
      reference_type
      reference_id
      reference_number
      purchase_line_id
      sub_purchase_line_id
      amount
      entry_date
      payment_mode
      notes
      created_at
      updated_at
    }
  }
`

export const CREATE_FINANCIAL_ENTRY_MUTATION = `
  mutation CreateFinancialEntry(
    $company_id: uuid!,
    $supplier_id: uuid,
    $customer_id: uuid,
    $entry_type: String!,
    $reference_type: String!,
    $reference_id: uuid,
    $reference_number: String,
    $purchase_line_id: String,
    $sub_purchase_line_id: String,
    $amount: numeric!,
    $entry_date: date!,
    $payment_mode: String,
    $notes: String
  ) {
    insert_financial_entries_one(object: {
      company_id: $company_id
      supplier_id: $supplier_id
      customer_id: $customer_id
      entry_type: $entry_type
      reference_type: $reference_type
      reference_id: $reference_id
      reference_number: $reference_number
      purchase_line_id: $purchase_line_id
      sub_purchase_line_id: $sub_purchase_line_id
      amount: $amount
      entry_date: $entry_date
      payment_mode: $payment_mode
      notes: $notes
    }) {
      id
      company_id
      supplier_id
      customer_id
      entry_type
      reference_type
      reference_id
      reference_number
      purchase_line_id
      sub_purchase_line_id
      amount
      entry_date
      payment_mode
      notes
      created_at
      updated_at
    }
  }
`
// ─── Suppliers & Customers admin list queries ────────────────────────────────

export const SUPPLIERS_LIST_QUERY = `
  query GetSuppliersList {
    suppliers(order_by: {name: asc}) {
      id name contact_person phone email city state gstin is_active created_at
    }
  }
`

export const CUSTOMERS_LIST_QUERY = `
  query GetCustomersList {
    customers(order_by: {name: asc}) {
      id name contact_person phone email city state gstin is_active created_at
    }
  }
`

// ─── Job Work Orders ─────────────────────────────────────────────────────────

export const JOB_WORK_ORDERS_QUERY = `
  query GetJobWorkOrders {
    job_work_orders(order_by: {dispatch_date: desc}, limit: 50) {
      id reference_number dispatch_date expected_return_date actual_return_date status notes created_at
      companies { name code }
      suppliers { name }
      job_work_items {
        quantity_sent quantity_received size_label
        material_types { name }
        material_sizes { size_label }
      }
    }
  }
`

export const JOB_WORK_ORDER_BY_ID_QUERY = `
  query GetJobWorkOrderById($id: uuid!) {
    job_work_orders_by_pk(id: $id) {
      id reference_number dispatch_date expected_return_date actual_return_date status notes created_at
      companies { name }
      warehouses { name }
      suppliers { name }
    }
  }
`

export const JOB_WORK_ITEMS_QUERY = `
  query GetJobWorkItems($job_work_order_id: uuid!) {
    job_work_items(where: {job_work_order_id: {_eq: $job_work_order_id}}, order_by: {id: asc}) {
      id job_work_order_id purchase_line_id sub_purchase_line_id quantity_sent quantity_received size_label
      material_types { name }
      material_sizes { size_label }
    }
  }
`

export const CREATE_JOB_WORK_ORDER_MUTATION = `
  mutation CreateJobWorkOrder($reference_number: String!, $company_id: uuid, $warehouse_id: uuid, $vendor_id: uuid, $dispatch_date: date!, $expected_return_date: date, $work_description: String, $status: String!, $notes: String) {
    insert_job_work_orders_one(object: {
      reference_number: $reference_number
      company_id: $company_id
      warehouse_id: $warehouse_id
      vendor_id: $vendor_id
      dispatch_date: $dispatch_date
      expected_return_date: $expected_return_date
      work_description: $work_description
      status: $status
      notes: $notes
    }) { id }
  }
`

export const CREATE_JOB_WORK_ITEMS_MUTATION = `
  mutation CreateJobWorkItems($objects: [job_work_items_insert_input!]!) {
    insert_job_work_items(objects: $objects) { affected_rows }
  }
`

export const UPDATE_JOB_WORK_ITEM_MUTATION = `
  mutation UpdateJobWorkItem($id: uuid!, $quantity_received: numeric!) {
    update_job_work_items_by_pk(pk_columns: {id: $id}, _set: {quantity_received: $quantity_received}) {
      id quantity_received
    }
  }
`

export const UPDATE_JOB_WORK_ORDER_STATUS_MUTATION = `
  mutation UpdateJobWorkOrderStatus($id: uuid!, $status: String!, $actual_return_date: date) {
    update_job_work_orders_by_pk(pk_columns: {id: $id}, _set: {status: $status, actual_return_date: $actual_return_date}) {
      id status
    }
  }
`

export const VENDOR_STOCK_QUERY = `
  query GetVendorStock {
    v_stock_at_vendors {
      vendor_name
      material_type_name
      size_label
      pending_quantity
    }
  }
`

// ─── Stock Ledger / Movements ────────────────────────────────────────────────

export const STOCK_LEDGER_QUERY = `
  query GetStockLedger($where: stock_ledger_bool_exp = {}) {
    stock_ledger(
      where: $where
      order_by: [{entry_date: desc}, {created_at: desc}]
      limit: 200
    ) {
      id entry_type quantity entry_date reference_number reference_type purchase_line_id sub_purchase_line_id size_label notes created_at
      companies { id name code }
      warehouses { name }
      material_types { name unit }
      material_sizes { size_label }
    }
  }
`

export const STOCK_LEDGER_FILTERED_QUERY = `
  query GetStockLedgerFiltered($where: stock_ledger_bool_exp = {}) {
    stock_ledger(
      where: $where
      order_by: [{entry_date: desc}, {created_at: desc}]
      limit: 200
    ) {
      id entry_type quantity entry_date reference_number reference_type purchase_line_id sub_purchase_line_id size_label notes created_at
      companies { id name code }
      warehouses { name }
      material_types { name unit }
      material_sizes { size_label }
    }
  }
`

export const RECENT_MOVEMENTS_QUERY = `
  query GetRecentMovements {
    stock_ledger(order_by: {created_at: desc}, limit: 10) {
      id entry_type quantity entry_date reference_number reference_type size_label
      companies { name }
      warehouses { name }
      material_types { name unit }
    }
  }
`

// ─── Inventory / Reports ─────────────────────────────────────────────────────

export const CURRENT_STOCK_QUERY = `
  query GetCurrentStock {
    v_current_stock(order_by: {company_name: asc}) {
      company_id company_name company_code
      warehouse_id warehouse_name
      material_type_id material_type_name unit
      size_label current_stock
    }
  }
`

export const REPORTS_QUERY = `
  query GetReports {
    v_current_stock {
      company_name company_code material_type_name unit size_label current_stock
    }
    v_stock_at_vendors {
      vendor_name material_type_name size_label pending_quantity
    }
    purchase_bills(order_by: {bill_date: desc}) {
      bill_date total_quantity total_amount
      companies { name code }
    }
    dispatch_orders(order_by: {dispatch_date: desc}) {
      dispatch_date total_quantity total_amount
      companies { name code }
    }
  }
`

// ─── Admin Mutations (already defined above, listed here for clarity) ────────
// CREATE_COMPANY_MUTATION, CREATE_WAREHOUSE_MUTATION, CREATE_SUPPLIER_MUTATION,
// CREATE_CUSTOMER_MUTATION, CREATE_MATERIAL_TYPE_MUTATION,
// CREATE_MATERIAL_SIZE_MUTATION, CREATE_USER_PROFILE_MUTATION
// CREATE_PURCHASE_BILL_MUTATION

// ─── Stock Statement ─────────────────────────────────────────────────────────

export const STOCK_STATEMENT_QUERY = `
  query GetStockStatement($opening_where: stock_ledger_bool_exp = {}, $period_where: stock_ledger_bool_exp = {}) {
    opening: stock_ledger(where: $opening_where, limit: 5000) {
      quantity material_type_id material_size_id size_label
      material_types { name unit }
      material_sizes { size_label }
    }
    period: stock_ledger(where: $period_where, limit: 5000) {
      entry_type quantity material_type_id material_size_id size_label
      material_types { name unit }
      material_sizes { size_label }
    }
  }
`

// ─── Billing Report ──────────────────────────────────────────────────────────

export const BILLING_REPORT_QUERY = `
  query GetBillingReport($where: purchase_bills_bool_exp = {}) {
    purchase_bills(where: $where, order_by: {bill_date: asc}, limit: 1000) {
      id bill_number bill_date total_quantity total_amount notes
      companies { name code }
      warehouses { name }
      suppliers { name }
      purchase_bill_items {
        quantity rate amount size_label unit
        material_types { name unit }
        material_sizes { size_label }
      }
    }
  }
`

// ─── Transfers Report ─────────────────────────────────────────────────────────

export const TRANSFERS_REPORT_QUERY = `
  query GetTransfersReport($where: transfers_bool_exp = {}) {
    transfers(where: $where, order_by: {transfer_date: asc}, limit: 1000) {
      id transfer_date status notes
      companies_from { name code }
      companies_to { name code }
      warehouses_from { name }
      warehouses_to { name }
      transfer_items {
        quantity size_label
        material_types { name }
        material_sizes { size_label }
      }
    }
  }
`

// ─── Dispatch Report ─────────────────────────────────────────────────────────

export const DISPATCH_REPORT_QUERY = `
  query GetDispatchReport($where: dispatch_orders_bool_exp = {}) {
    dispatch_orders(where: $where, order_by: {dispatch_date: asc}, limit: 1000) {
      id dispatch_date vehicle_number driver_name invoice_number notes
      companies { name code }
      warehouses { name }
      customers { name }
      dispatch_items {
        quantity rate amount size_label
        material_types { name }
        material_sizes { size_label }
      }
    }
  }
`

// ─── Job Work Report ─────────────────────────────────────────────────────────

export const JOB_WORK_REPORT_QUERY = `
  query GetJobWorkReport($where: job_work_orders_bool_exp = {}) {
    job_work_orders(where: $where, order_by: {dispatch_date: asc}, limit: 1000) {
      id reference_number dispatch_date expected_return_date actual_return_date status notes
      companies { name code }
      warehouses { name }
      suppliers { name }
      job_work_items {
        quantity_sent quantity_received size_label
        material_types { name unit }
        material_sizes { size_label }
      }
    }
  }
`

// ─── Movements Report ────────────────────────────────────────────────────────

export const MOVEMENTS_REPORT_QUERY = `
  query GetMovementsReport($where: stock_ledger_bool_exp = {}) {
    stock_ledger(where: $where, order_by: [{entry_date: asc}, {created_at: asc}], limit: 2000) {
      id entry_type quantity entry_date reference_number reference_type purchase_line_id sub_purchase_line_id size_label notes
      companies { name code }
      warehouses { name }
      material_types { name unit }
      material_sizes { size_label }
    }
  }
`

