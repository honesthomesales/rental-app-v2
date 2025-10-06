'use client'

import React, { useEffect, useState } from 'react'
import { Expense } from '@/types/database'
import { BuildingOfficeIcon, PlusIcon, MagnifyingGlassIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline'

type SortField = 'address' | 'amount_owed' | 'last_paid_date' | 'mail_info' | 'loan_number' | 'phone_number' | 'balance' | 'interest_rate'
type SortDirection = 'asc' | 'desc'

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [filteredExpenses, setFilteredExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortField, setSortField] = useState<SortField>('address')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  useEffect(() => {
    fetchExpenses()
  }, [])

  useEffect(() => {
    filterAndSortExpenses()
  }, [expenses, searchTerm, sortField, sortDirection])

  const fetchExpenses = async () => {
    try {
      const response = await fetch('/api/expenses')
      
      if (!response.ok) {
        const errorData = await response.json()
        console.error('API error:', errorData)
        throw new Error(errorData.error || 'Failed to fetch expenses')
      }
      
      const data = await response.json()
      setExpenses(data)
    } catch (error) {
      console.error('Error fetching expenses:', error)
    } finally {
      setLoading(false)
    }
  }

  const filterAndSortExpenses = () => {
    let filtered = expenses.filter(expense => {
      const searchLower = searchTerm.toLowerCase()
      return (
        expense.address.toLowerCase().includes(searchLower) ||
        expense.mail_info?.toLowerCase().includes(searchLower) ||
        expense.loan_number?.toLowerCase().includes(searchLower) ||
        expense.phone_number?.toLowerCase().includes(searchLower)
      )
    })

    filtered.sort((a, b) => {
      let aValue: any = a[sortField]
      let bValue: any = b[sortField]

      // Handle different data types
      if (typeof aValue === 'string') {
        aValue = aValue.toLowerCase()
        bValue = bValue.toLowerCase()
      } else if (typeof aValue === 'number') {
        // Numbers are already comparable
        aValue = aValue || 0
        bValue = bValue || 0
      } else {
        // Handle undefined/null values
        aValue = aValue || ''
        bValue = bValue || ''
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1
      return 0
    })

    setFilteredExpenses(filtered)
  }

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

  const handleAddExpense = () => {
    setEditingExpense(null)
    setShowAddModal(true)
  }

  const handleEditExpense = (expense: Expense) => {
    setEditingExpense(expense)
    setShowAddModal(true)
  }

  const handleSaveExpense = async (expenseData: Partial<Expense>) => {
    try {
      const url = editingExpense ? '/api/expenses' : '/api/expenses'
      const method = editingExpense ? 'PUT' : 'POST'
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(editingExpense ? { id: editingExpense.id, ...expenseData } : expenseData)
      })

      if (!response.ok) {
        const errorData = await response.json()
        console.error('API error:', errorData)
        throw new Error(errorData.error || 'Failed to save expense')
      }

      await fetchExpenses()
      setShowAddModal(false)
      setEditingExpense(null)
    } catch (error) {
      console.error('Error saving expense:', error)
      alert('Failed to save expense. Please try again.')
    }
  }

  const handleDeleteExpense = async (expense: Expense) => {
    if (!confirm(`Are you sure you want to delete the expense for ${expense.address}?`)) {
      return
    }

    try {
      const response = await fetch(`/api/expenses?id=${expense.id}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        const errorData = await response.json()
        console.error('API error:', errorData)
        throw new Error(errorData.error || 'Failed to delete expense')
      }

      await fetchExpenses()
    } catch (error) {
      console.error('Error deleting expense:', error)
      alert('Failed to delete expense. Please try again.')
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount)
  }

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A'
    return new Date(dateString).toLocaleDateString()
  }

  const formatPercentage = (rate: number) => {
    return `${(rate * 100).toFixed(2)}%`
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading expenses...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Expenses</h1>
              <p className="mt-2 text-gray-600">Manage property expenses and payments</p>
            </div>
            <button
              onClick={handleAddExpense}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center space-x-2"
            >
              <PlusIcon className="h-5 w-5" />
              <span>Add Expense</span>
            </button>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="mb-6">
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search expenses by address, mail info, loan number, or phone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* Expenses Table */}
        <div className="bg-white shadow-sm rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th 
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('address')}
                  >
                    <div className="flex items-center">
                      Address
                      {sortField === 'address' && (
                        <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </th>
                  <th 
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('amount_owed')}
                  >
                    <div className="flex items-center">
                      Amount Owed
                      {sortField === 'amount_owed' && (
                        <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </th>
                  <th 
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('last_paid_date')}
                  >
                    <div className="flex items-center">
                      Last Paid Date
                      {sortField === 'last_paid_date' && (
                        <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </th>
                  <th 
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('mail_info')}
                  >
                    <div className="flex items-center">
                      Mail Info
                      {sortField === 'mail_info' && (
                        <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </th>
                  <th 
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('loan_number')}
                  >
                    <div className="flex items-center">
                      Loan Number
                      {sortField === 'loan_number' && (
                        <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </th>
                  <th 
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('phone_number')}
                  >
                    <div className="flex items-center">
                      Phone #
                      {sortField === 'phone_number' && (
                        <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </th>
                  <th 
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('balance')}
                  >
                    <div className="flex items-center">
                      Balance
                      {sortField === 'balance' && (
                        <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </th>
                  <th 
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('interest_rate')}
                  >
                    <div className="flex items-center">
                      Interest Rate
                      {sortField === 'interest_rate' && (
                        <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredExpenses.map((expense) => (
                  <tr key={expense.id} className="hover:bg-gray-50">
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <BuildingOfficeIcon className="h-5 w-5 text-blue-600 mr-3" />
                        <div className="text-sm font-medium text-gray-900">{expense.address}</div>
                      </div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatCurrency(expense.amount_owed)}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatDate(expense.last_paid_date)}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 max-w-xs truncate">
                      {expense.mail_info || 'N/A'}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                      {expense.loan_number || 'N/A'}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                      {expense.phone_number || 'N/A'}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatCurrency(expense.balance)}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatPercentage(expense.interest_rate)}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex space-x-2">
                        <button
                          onClick={() => handleEditExpense(expense)}
                          className="text-blue-600 hover:text-blue-900"
                          title="Edit Expense"
                        >
                          <PencilIcon className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteExpense(expense)}
                          className="text-red-600 hover:text-red-900"
                          title="Delete Expense"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Empty State */}
        {filteredExpenses.length === 0 && (
          <div className="text-center py-12">
            <BuildingOfficeIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">No expenses found</h3>
            <p className="mt-1 text-sm text-gray-500">
              {searchTerm ? 'Try adjusting your search criteria.' : 'Get started by adding a new expense.'}
            </p>
            {!searchTerm && (
              <div className="mt-6">
                <button
                  onClick={handleAddExpense}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center space-x-2 mx-auto"
                >
                  <PlusIcon className="h-5 w-5" />
                  <span>Add Expense</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add/Edit Expense Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              {editingExpense ? 'Edit Expense' : 'Add New Expense'}
            </h2>
            <form onSubmit={(e) => {
              e.preventDefault()
              const formData = new FormData(e.currentTarget)
              const expenseData = {
                address: formData.get('address') as string,
                amount_owed: parseFloat(formData.get('amount_owed') as string) || 0,
                last_paid_date: formData.get('last_paid_date') as string || undefined,
                mail_info: formData.get('mail_info') as string || undefined,
                loan_number: formData.get('loan_number') as string || undefined,
                phone_number: formData.get('phone_number') as string || undefined,
                balance: parseFloat(formData.get('balance') as string) || 0,
                interest_rate: parseFloat(formData.get('interest_rate') as string) || 0
              }
              handleSaveExpense(expenseData)
            }}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Address *</label>
                  <input
                    type="text"
                    name="address"
                    defaultValue={editingExpense?.address || ''}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Amount Owed *</label>
                    <input
                      type="number"
                      name="amount_owed"
                      step="0.01"
                      defaultValue={editingExpense?.amount_owed || ''}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Balance *</label>
                    <input
                      type="number"
                      name="balance"
                      step="0.01"
                      defaultValue={editingExpense?.balance || ''}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Last Paid Date</label>
                  <input
                    type="date"
                    name="last_paid_date"
                    defaultValue={editingExpense?.last_paid_date || ''}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Mail Info</label>
                  <textarea
                    name="mail_info"
                    rows={3}
                    defaultValue={editingExpense?.mail_info || ''}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    placeholder="Additional information about the expense"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Loan Number</label>
                    <input
                      type="text"
                      name="loan_number"
                      defaultValue={editingExpense?.loan_number || ''}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Phone Number</label>
                    <input
                      type="tel"
                      name="phone_number"
                      defaultValue={editingExpense?.phone_number || ''}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Interest Rate (%)</label>
                  <input
                    type="number"
                    name="interest_rate"
                    step="0.0001"
                    min="0"
                    max="1"
                    defaultValue={editingExpense?.interest_rate || ''}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    placeholder="Enter as decimal (e.g., 0.0525 for 5.25%)"
                  />
                </div>
              </div>
              <div className="mt-6 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false)
                    setEditingExpense(null)
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  {editingExpense ? 'Update Expense' : 'Add Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
