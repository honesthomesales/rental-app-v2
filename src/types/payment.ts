export interface Payment {
  id: string
  amount: number
  date: string
  method: string
  type: string
  notes?: string
  createdAt: string
}

export interface PaymentModalData {
  leaseId: string
  periodStart: string
  periodEnd: string
  invoiceAmount: number
  payments: Payment[]
  totalPaid: number
  balance: number
  status: 'paid' | 'partial' | 'unpaid' | 'no_invoice'
}

export interface PaymentApiResponse {
  success: boolean
  payments: Payment[]
  error?: string
}
