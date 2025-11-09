export interface Property {
  id: string
  name: string
  address: string
  city: string
  state: string
  zip_code: string
  bedrooms?: number
  bathrooms?: number
  square_feet?: number
  year_built?: number
  purchase_price?: number
  purchase_date?: string
  current_value?: number
  is_for_sale?: boolean
  is_for_rent?: boolean
  insurance_policy_number?: string
  insurance_provider?: string
  insurance_premium?: number
  owner_name?: string
  property_type?: 'house' | 'doublewide' | 'singlewide' | 'loan'
  Sell_Price?: number
  Interest_Rate?: number
  property_tax?: number
  purchase_payment?: number
  Map_ID?: string
  notes?: string
  address_line1?: string
  address_line2?: string
  postal_code?: string
  unit?: string
  insurance_payment?: number
  tax_payment?: number
  rent_value?: number
  created_at?: string
  updated_at?: string
}

export interface Tenant {
  id: string
  property_id?: string
  first_name: string
  last_name: string
  email?: string
  phone?: string
  notes?: string
  is_active?: boolean
  lease_start_date?: string
  lease_end_date?: string
  currently_paid_up_date?: string
  full_name?: string
  created_at?: string
  updated_at?: string
  property?: Property
}

export interface Lease {
  id: string
  property_id?: string
  tenant_id?: string
  lease_start_date: string
  lease_end_date: string
  rent: number
  rent_cadence?: 'weekly' | 'biweekly' | 'monthly'
  move_in_fee?: number
  late_fee_amount?: number
  lease_pdf_url?: string
  status?: 'active' | 'inactive' | 'terminated'
  notes?: string
  rent_due_day?: number
  due_weekday?: number
  period_anchor_date?: string
  created_at?: string
  updated_at?: string
}

export interface RentPeriod {
  id: string
  tenant_id?: string
  property_id?: string
  lease_id?: string
  period_due_date: string
  amount_paid?: number
  late_fee_applied?: number
  late_fee_waived?: boolean
  due_date_override?: string
  notes?: string
  created_at?: string
  updated_at?: string
}

export interface Payment {
  id: string
  property_id?: string
  tenant_id?: string
  lease_id?: string
  payment_date: string
  amount: number
  payment_type: string
  payment_method?: string
  status?: 'completed' | 'pending' | 'failed'
  notes?: string
  date_paid?: string
  method?: string
  memo?: string
  created_at?: string
  updated_at?: string
}

export interface PaymentAllocation {
  id: string
  payment_id: string
  rent_period_id: string
  invoice_id?: string
  amount_to_rent?: number
  amount_to_late_fee?: number
  applied_at?: string
  created_at?: string
  updated_at?: string
}

// Dashboard data types
export interface DashboardMetrics {
  totalProperties: number
  occupiedProperties: number
  monthlyIncome: number
  potentialIncome: number
  totalPotentialIncome: number
  latePayments: number
  totalOwed: number
  propertyTypeBreakdown: {
    house: number
    doublewide: number
    singlewide: number
    loan: number
  }
}

// Payments grid types
export interface PaymentGridData {
  property: Property
  tenant: Tenant
  lease: Lease
  totalOwed: number
  periods: RentPeriodStatus[]
}

export interface PaymentDetail {
  id: string
  date: string
  amount: number
  type: string
  notes?: string
}

export interface RentPeriodStatus {
  periodId: string
  dueDate: string
  status: 'paid' | 'partial' | 'late' | 'due' | 'owed' | 'upcoming' | 'inactive' | 'outside_lease'
  billedRent: number
  lateFee: number
  allocatedRent: number
  allocatedLateFee: number
  remaining: number
  isActive: boolean
  amount: number
  amountPaid: number
  amountDue: number
  payments: PaymentDetail[]
}

// Late tenants types
export interface LateTenantData {
  property: Property
  tenant: Tenant
  lease: Lease
  daysLate: number
  latePeriodsCount: number
  totalOwedLate: number
  oldestLatePeriod: string
  mostRecentPayment?: {
    date: string
    amount: number
    method: string
  }
}

// Profit analysis types
export interface ProfitMetrics {
  grossCollected: number
  effectiveGrossIncome: number
  operatingExpenses: number
  netOperatingIncome: number
  cashFlowAfterDebt: number
  collectionRate: number
  lateFeeYield: number
}

export interface PropertyProfitData {
  property: Property
  scheduledRent: number
  rentCollected: number
  lateFees: number
  otherIncome: number
  effectiveGrossIncome: number
  operatingExpenses: number
  netOperatingIncome: number
  debtService: number
  cashFlowAfterDebt: number
}

export interface Invoice {
  id: string
  tenant_id?: string
  lease_id?: string
  property_id?: string
  due_date: string
  amount: number
  status: 'pending' | 'paid' | 'overdue' | 'cancelled' | 'VOID'
  invoice_number?: string
  description?: string
  notes?: string
  void_reason?: string
  voided_at?: string
  created_at?: string
  updated_at?: string
  // Joined fields from API response
  tenant_name?: string
  tenant_email?: string
  tenant_phone?: string
  property_name?: string
  property_address?: string
  property_city?: string
  property_state?: string
  property_zip?: string
}

export interface InvoiceAllocationDetail {
  id: string
  payment_id: string
  rent_period_id: string
  invoice_id?: string
  amount_to_rent?: number
  amount_to_late_fee?: number
  applied_at?: string
  created_at?: string
  updated_at?: string
  payment: {
    id: string
    payment_date: string
    amount: number
    payment_type: string
    payment_method?: string
    status?: 'completed' | 'pending' | 'failed'
    notes?: string
    tenant_id?: string
    property_id?: string
    lease_id?: string
  }
}

export interface InvoiceAllocationSummary {
  allocationId: string
  paymentId: string
  appliedAt: string
  amountToRent: number
  amountToLateFee: number
  amountToOther?: number
  receivedAt: string
  memo?: string | null
}

export interface InvoiceDetailResponse {
  invoice: Invoice & {
    tenant_name?: string
    tenant_email?: string
    tenant_phone?: string
    property_name?: string
    property_address?: string
    property_city?: string
    property_state?: string
    property_zip?: string
  }
  allocations: InvoiceAllocationSummary[]
}

export interface PaymentCreateRequest {
  tenantId: string
  leaseId: string
  amount: number
  receivedAt?: string
  memo?: string
}

export interface PaymentAllocationResult {
  id: string
  payment_id: string
  invoice_id?: string
  rent_period_id?: string
  amount_allocated: number
  allocation_type: 'rent' | 'late_fee'
  created_at: string
}

export interface PaymentResponse {
  payment: Payment & {
    tenant_name?: string
    tenant_email?: string
    property_name?: string
    property_address?: string
    lease_rent?: number
    lease_status?: string
  }
  allocations: PaymentAllocationResult[]
  warning?: string
  error?: string
}

export interface ManualAllocationRequest {
  paymentId: string
  allocations: {
    invoiceId: string
    amount: number
    appliedAt?: string
  }[]
}

export interface ManualAllocationResponse {
  success: boolean
  payment: Payment
  invoices: (Invoice & {
    tenant_name?: string
    tenant_email?: string
    property_name?: string
    property_address?: string
    property_city?: string
    property_state?: string
  })[]
  allocations: (PaymentAllocation & {
    payment: {
      id: string
      payment_date: string
      amount: number
      payment_type: string
      payment_method?: string
      status?: string
    }
  })[]
  recalculation: {
    successful: number
    failed: number
    errors?: {
      invoiceId: string
      error: string
    }[]
  }
}

export interface VoidInvoiceRequest {
  reason: string
}

export interface VoidInvoiceResponse {
  success: boolean
  message: string
  invoice: Invoice & {
    tenant_name?: string
    tenant_email?: string
    property_name?: string
    property_address?: string
    property_city?: string
    property_state?: string
    void_reason?: string
    voided_at?: string
  }
  void_reason: string
  voided_at: string
}

export interface PeriodInvoiceMap {
  rent_period_id: string
  lease_id: string
  period_due_date: string
  invoice_id?: string | null
  status: 'PAID' | 'PARTIAL' | 'OPEN' | 'VOID'
  amount_paid: number
  balance_due: number
  period_amount: number
  late_fee_amount?: number
  created_at?: string
  updated_at?: string
}

export interface Expense {
  id: string
  property_id?: string
  lease_id?: string
  category?: string
  amount?: number
  expense_date?: string
  memo?: string
  attachment_url?: string
  address: string
  amount_owed: number
  due_date?: string
  last_paid_date?: string
  mail_info?: string
  loan_number?: string
  phone_number?: string
  balance: number
  interest_rate: number
  created_at?: string
  updated_at?: string
}