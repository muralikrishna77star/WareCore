# WareCore Client Ready Reckoner

## Overview
This is a quick reference for WareCore operations. It explains each main option, the activity it performs, and real examples for common workflows.

---

## Main Modules and Activities

### 1. Purchase Entry
- Purpose: Record inbound purchase bills and add stock to the system.
- What it does:
  - Captures supplier invoices and purchase details.
  - Adds purchased material to inventory.
  - Creates inbound stock entries for auditing.
- Examples:
  - Record a purchase bill for 10 MT of steel coil from Supplier X.
  - Capture item details: company, warehouse, material, size, quantity, rate, and notes.

### 2. Inventory
- Purpose: View live stock levels across companies, warehouses, materials, and sizes.
- What it does:
  - Shows current available quantity for every material.
  - Helps verify stock before dispatch, transfer, or job work.
- Examples:
  - Check how much material remains at Warehouse A.
  - Confirm available stock before creating a dispatch order.

### 3. Movements
- Purpose: See the full stock ledger and transaction history.
- What it does:
  - Shows all stock changes over time.
  - Includes inbound, outbound, transfers, job work, and returns.
- Examples:
  - Review stock movements for the last 30 days.
  - Audit a `Transfer Out` and corresponding `Transfer In` transaction.

### 4. Transfers
- Purpose: Move material internally between companies or warehouses.
- What it does:
  - Creates an internal stock movement record.
  - Transfers stock without customer delivery.
- Examples:
  - Move 5 MT from Company A Warehouse 1 to Company B Warehouse 2.
  - Relocate material between two internal warehouses for production.

### 5. Job Work
- Purpose: Send material to an external vendor for processing and track its return.
- What it does:
  - Records material leaving for processing (slitting, shearing, etc.).
  - Tracks expected return date and return status.
  - Helps update inventory when processed material comes back.
- Examples:
  - Send 2 coils to a vendor for slitting with an expected return in 7 days.
  - Record the job work order with vendor name, work description, dispatch date, and return deadline.
- When to use it:
  - Use Job Work when material is not sold; it is sent away for processing and will return.

### 6. Dispatch
- Purpose: Manage customer deliveries and outbound shipments.
- What it does:
  - Creates dispatch orders for sales deliveries.
  - Captures vehicle number, driver, invoice, and dispatch details.
  - Deducts stock from the warehouse when goods leave.
- Examples:
  - Dispatch material to Customer Y on a specific delivery date.
  - Record driver name, vehicle number, and invoice number for the shipment.

### 7. Reports
- Purpose: Generate summary insights and business analytics.
- What it does:
  - Provides reports on stock, transfers, dispatches, and job work.
  - Helps monitor operational performance and pending work.
- Examples:
  - View total pending transfers and active job work orders.
  - Analyze stock movement trends by month.

### 8. Admin
- Purpose: Manage master data and user access.
- What it does:
  - Maintains companies, warehouses, suppliers, customers, materials, and sizes.
  - Manages system roles and user permissions.
- Examples:
  - Add a new warehouse or customer profile.
  - Assign permissions to `warehouse_manager`, `sales_manager`, or `billing_staff`.

---

## Quick Usage Guide
- If material is moving inside your organization: use **Transfers**.
- If material is sent outside for processing and will return: use **Job Work**.
- If material is leaving for a customer sale: use **Dispatch**.
- If you need to check stock before any activity: use **Inventory**.
- If you need to trace what happened to stock: use **Movements**.
- If you are recording purchases: use **Purchase Entry**.
- If you need to manage master records or users: use **Admin**.

---

## Examples by Scenario

### Scenario A: Internal warehouse relocation
- Module: Transfers
- Example activity: Move stock from Warehouse 1 to Warehouse 2 for internal use.

### Scenario B: Vendor processing
- Module: Job Work
- Example activity: Send raw material to a vendor for shearing and track the expected return.

### Scenario C: Sales shipment
- Module: Dispatch
- Example activity: Dispatch finished product to a customer with vehicle and driver details.

### Scenario D: Stock audit
- Module: Movements / Inventory
- Example activity: Review the complete stock ledger and verify current inventory levels.

---

## Key distinction: Job Work vs Transfer
- Job Work: external processing work. Material is sent out and expected to come back.
- Transfer: internal stock movement. Material stays within the company network.

---

## Roles and access
- `admin`: full access to master data and operational modules.
- `company_manager`: oversight of company operations and internal stock.
- `warehouse_manager`: warehouse-level stock control and transfers.
- `sales_manager`: dispatch and customer delivery management.
- `billing_staff`: purchase entry and billing-related workflows.

---

## Notes for users
- Always verify inventory before creating dispatch or transfer orders.
- Use `Job Work` only for processing jobs that return to stock.
- Use `Dispatch` only for customer sales deliveries.
- Use `Transfers` for internal operational stock movement.
- Use `Movements` as your audit trail for every stock transaction.
