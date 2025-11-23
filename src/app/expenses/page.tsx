'use client'

import React, { useEffect, useState } from 'react'
import { Expense } from '@/types/database'
import { BuildingOfficeIcon, PlusIcon, MagnifyingGlassIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline'

type SortField = 'category' | 'amount' | 'expense_date' | 'memo' | 'property_name' | 'day_of_month' | 'amount_owed' | 'last_paid_date' | 'mail_info' | 'loan_number' | 'phone_number' | 'balance' | 'interest_rate'
type SortDirection = 'asc' | 'desc'

type ExpenseWithProperty = Expense & {
  property_name?: string
  property_address?: string
  due_date?: string
}

type Property = {
  id: string
  name: string
  address: string
}

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<ExpenseWithProperty[]>([])
  const [filteredExpenses, setFilteredExpenses] = useState<ExpenseWithProperty[]>([])
  const [oneTimeExpenses, setOneTimeExpenses] = useState<ExpenseWithProperty[]>([])
  const [filteredOneTimeExpenses, setFilteredOneTimeExpenses] = useState<ExpenseWithProperty[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showOneTimeModal, setShowOneTimeModal] = useState(false)
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null)
  const [editingOneTimeExpense, setEditingOneTimeExpense] = useState<Expense | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortField, setSortField] = useState<SortField>('expense_date')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  useEffect(() => {
    fetchExpenses()
    fetchProperties()
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

  const fetchProperties = async () => {
    try {
      const response = await fetch('/api/properties')
      
      if (!response.ok) {
        const errorData = await response.json()
        console.error('API error:', errorData)
        throw new Error(errorData.error || 'Failed to fetch properties')
      }
      
      const data = await response.json()
      setProperties(data)
    } catch (error) {
      console.error('Error fetching properties:', error)
    }
  }

  const filterAndSortExpenses = () => {
    // Separate regular expenses from one-time expenses
    const regularExpenses = expenses.filter(expense => expense.interest_rate !== -999)
    const oneTime = expenses.filter(expense => expense.interest_rate === -999)
    
    setOneTimeExpenses(oneTime)

    // Filter regular expenses
    let filtered = regularExpenses.filter(expense => {
      const searchLower = searchTerm.toLowerCase()
      return (
        expense.property_name?.toLowerCase().includes(searchLower) ||
        expense.property_address?.toLowerCase().includes(searchLower) ||
        expense.mail_info?.toLowerCase().includes(searchLower) ||
        expense.loan_number?.toLowerCase().includes(searchLower) ||
        expense.phone_number?.toLowerCase().includes(searchLower) ||
        expense.category?.toLowerCase().includes(searchLower)
      )
    })

    // Filter one-time expenses
    let filteredOneTime = oneTime.filter(expense => {
      const searchLower = searchTerm.toLowerCase()
      return (
        expense.property_name?.toLowerCase().includes(searchLower) ||
        expense.property_address?.toLowerCase().includes(searchLower) ||
        expense.mail_info?.toLowerCase().includes(searchLower)
      )
    })

    // Sort regular expenses
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

    // Sort one-time expenses by date paid (descending)
    filteredOneTime.sort((a, b) => {
      const aDate = a.last_paid_date || ''
      const bDate = b.last_paid_date || ''
      return bDate.localeCompare(aDate)
    })

    setFilteredExpenses(filtered)
    setFilteredOneTimeExpenses(filteredOneTime)
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

  const handleAddOneTimeExpense = () => {
    setEditingOneTimeExpense(null)
    setShowOneTimeModal(true)
  }

  const handleEditExpense = (expense: Expense) => {
    setEditingExpense(expense)
    setShowAddModal(true)
  }

  const handleEditOneTimeExpense = (expense: Expense) => {
    setEditingOneTimeExpense(expense)
    setShowOneTimeModal(true)
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

  const handleSaveOneTimeExpense = async (expenseData: Partial<Expense>) => {
    try {
      const url = editingOneTimeExpense ? '/api/expenses' : '/api/expenses'
      const method = editingOneTimeExpense ? 'PUT' : 'POST'
      
      // Ensure interest_rate is set to -999 for one-time expenses
      // Filter out undefined and empty string values
      const oneTimeData: any = {
        interest_rate: -999,
        balance: 0, // Set balance to 0 for one-time expenses
        address: 'N/A',
        category: 'One-Time Expense',
        amount_owed: expenseData.amount_owed || 0,
        mail_info: expenseData.mail_info || '',
        last_paid_date: expenseData.last_paid_date,
        expense_date: expenseData.expense_date || expenseData.last_paid_date || new Date().toISOString().split('T')[0],
        amount: expenseData.amount || expenseData.amount_owed || 0,
        memo: expenseData.mail_info || ''
      }
      
      // Only include property_id if it's provided
      if (expenseData.property_id) {
        oneTimeData.property_id = expenseData.property_id
      }
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(editingOneTimeExpense ? { id: editingOneTimeExpense.id, ...oneTimeData } : oneTimeData)
      })

      if (!response.ok) {
        const errorData = await response.json()
        console.error('API error:', errorData)
        const errorMessage = errorData.error || 'Failed to save one-time expense'
        console.error('Error details:', errorData.details)
        throw new Error(errorMessage)
      }

      await fetchExpenses()
      setShowOneTimeModal(false)
      setEditingOneTimeExpense(null)
    } catch (error) {
      console.error('Error saving one-time expense:', error)
      alert('Failed to save one-time expense. Please try again.')
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

  const handleDeleteOneTimeExpense = async (expense: Expense) => {
    const description = expense.mail_info || 'this one-time expense'
    if (!confirm(`Are you sure you want to delete ${description}?`)) {
      return
    }

    try {
      const response = await fetch(`/api/expenses?id=${expense.id}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        const errorData = await response.json()
        console.error('API error:', errorData)
        throw new Error(errorData.error || 'Failed to delete one-time expense')
      }

      await fetchExpenses()
    } catch (error) {
      console.error('Error deleting one-time expense:', error)
      alert('Failed to delete one-time expense. Please try again.')
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
    return new Date(dateString + 'T12:00:00').toLocaleDateString()
  }

  const formatPercentage = (rate: number) => {
    return `${(rate * 100).toFixed(2)}%`
  }

  const calculateTotals = () => {
    return filteredExpenses.reduce(
      (acc, expense) => ({
        amount_owed: acc.amount_owed + (expense.amount_owed || 0),
        balance: acc.balance + (expense.balance || 0)
      }),
      { amount_owed: 0, balance: 0 }
    )
  }

  const calculateBalancePercent = (balance: number, amountOwed: number) => {
    if (amountOwed === 0) return '0.00%'
    return `${((balance / amountOwed) * 100).toFixed(2)}%`
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
            <div className="flex space-x-3">
              <button
                onClick={handleAddExpense}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center space-x-2"
              >
                <PlusIcon className="h-5 w-5" />
                <span>Add Expense</span>
              </button>
              <button
                onClick={handleAddOneTimeExpense}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg flex items-center space-x-2"
              >
                <PlusIcon className="h-5 w-5" />
                <span>Add One-Time Expense</span>
              </button>
            </div>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="mb-6">
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search expenses by property, category, mail info, loan number, or phone..."
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
                    onClick={() => handleSort('property_name')}
                  >
                    <div className="flex items-center">
                      Property
                      {sortField === 'property_name' && (
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
                    onClick={() => handleSort('day_of_month')}
                  >
                    <div className="flex items-center">
                      Due Day
                      {sortField === 'day_of_month' && (
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
                    onClick={() => handleSort('balance')}
                  >
                    <div className="flex items-center">
                      Balance
                      {sortField === 'balance' && (
                        <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Percent
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
                  <tr 
                    key={expense.id} 
                    className="hover:bg-gray-50 cursor-pointer"
                    onDoubleClick={() => handleEditExpense(expense)}
                    title="Double-click to edit"
                  >
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <button
                          onClick={() => handleEditExpense(expense)}
                          className="text-blue-600 hover:text-blue-900 mr-3"
                          title="Edit Expense"
                        >
                          <PencilIcon className="h-5 w-5" />
                        </button>
                        <div className="text-sm font-medium text-gray-900">
                          {expense.property_name || 'Unknown Property'}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatCurrency(expense.amount_owed)}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                      {expense.day_of_month ? `Day ${expense.day_of_month}` : 'N/A'}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatDate(expense.last_paid_date)}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 max-w-xs truncate">
                      {expense.mail_info || 'N/A'}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatCurrency(expense.balance)}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                      {calculateBalancePercent(expense.balance, expense.amount_owed)}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatPercentage(expense.interest_rate)}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex space-x-2">
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
                {filteredExpenses.length > 0 && (
                  <tr className="bg-gray-100 font-semibold">
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                      TOTALS
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatCurrency(calculateTotals().amount_owed)}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                      -
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                      -
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                      -
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatCurrency(calculateTotals().balance)}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                      {calculateBalancePercent(calculateTotals().balance, calculateTotals().amount_owed)}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                      -
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                      -
                    </td>
                  </tr>
                )}
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

        {/* One-Time Expenses Section */}
        {filteredOneTimeExpenses.length > 0 && (
          <div className="mt-12">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">One-Time Expenses</h2>
            <div className="bg-white shadow-sm rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Description
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Paid Amount
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Date Paid
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Property
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredOneTimeExpenses.map((expense) => (
                      <tr 
                        key={expense.id} 
                        className="hover:bg-gray-50 cursor-pointer"
                        onDoubleClick={() => handleEditOneTimeExpense(expense)}
                        title="Double-click to edit"
                      >
                        <td className="px-4 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <button
                              onClick={() => handleEditOneTimeExpense(expense)}
                              className="text-blue-600 hover:text-blue-900 mr-3"
                              title="Edit One-Time Expense"
                            >
                              <PencilIcon className="h-5 w-5" />
                            </button>
                            <div className="text-sm font-medium text-gray-900">
                              {expense.mail_info || 'N/A'}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                          {formatCurrency(expense.amount_owed || 0)}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                          {formatDate(expense.last_paid_date)}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                          {expense.property_name || '-'}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm font-medium">
                          <button
                            onClick={() => handleDeleteOneTimeExpense(expense)}
                            className="text-red-600 hover:text-red-900"
                            title="Delete One-Time Expense"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
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
                property_id: formData.get('property_id') as string,
                category: formData.get('category') as string,
                amount: parseFloat(formData.get('amount_owed') as string) || 0,
                expense_date: formData.get('last_paid_date') as string || new Date().toISOString().split('T')[0],
                memo: formData.get('mail_info') as string || '',
                amount_owed: parseFloat(formData.get('amount_owed') as string) || 0,
                day_of_month: formData.get('day_of_month') ? parseInt(formData.get('day_of_month') as string) : undefined,
                last_paid_date: formData.get('last_paid_date') as string || undefined,
                mail_info: formData.get('mail_info') as string || undefined,
                loan_number: formData.get('loan_number') as string || undefined,
                phone_number: (formData.get('phone_number') as string || '').substring(0, 20), // Truncate to 20 chars
                balance: parseFloat(formData.get('balance') as string) || 0,
                interest_rate: parseFloat(formData.get('interest_rate') as string) || 0
              }
              handleSaveExpense(expenseData)
            }}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Property *</label>
                  <select
                    name="property_id"
                    defaultValue={editingExpense?.property_id || ''}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    required
                  >
                    <option value="">Select a property</option>
                    {properties.map((property) => (
                      <option key={property.id} value={property.id}>
                        {property.name} - {property.address}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Category *</label>
                  <select
                    name="category"
                    defaultValue={editingExpense?.category || ''}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    required
                  >
                    <option value="">Select category</option>
                    <option value="Property Tax">Property Tax</option>
                    <option value="Insurance">Insurance</option>
                    <option value="Mortgage">Mortgage</option>
                    <option value="HOA">HOA</option>
                    <option value="Maintenance">Maintenance</option>
                    <option value="Utilities">Utilities</option>
                    <option value="Other">Other</option>
                  </select>
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
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Due Day of Month</label>
                    <input
                      type="number"
                      name="day_of_month"
                      min="1"
                      max="31"
                      defaultValue={editingExpense?.day_of_month || ''}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                      placeholder="Enter day (1-31)"
                    />
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

      {/* Add/Edit One-Time Expense Modal */}
      {showOneTimeModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              {editingOneTimeExpense ? 'Edit One-Time Expense' : 'Add New One-Time Expense'}
            </h2>
            <form onSubmit={(e) => {
              e.preventDefault()
              const formData = new FormData(e.currentTarget)
              const propertyId = formData.get('property_id') as string
              const expenseData: Partial<Expense> = {
                property_id: propertyId && propertyId !== '' ? propertyId : undefined,
                category: 'One-Time Expense',
                amount: parseFloat(formData.get('amount_owed') as string) || 0,
                expense_date: formData.get('last_paid_date') as string || new Date().toISOString().split('T')[0],
                memo: formData.get('mail_info') as string || '',
                amount_owed: parseFloat(formData.get('amount_owed') as string) || 0,
                last_paid_date: formData.get('last_paid_date') as string || undefined,
                mail_info: formData.get('mail_info') as string || undefined,
                address: 'N/A',
                balance: 0,
                interest_rate: -999
              }
              handleSaveOneTimeExpense(expenseData)
            }}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Description *</label>
                  <textarea
                    name="mail_info"
                    rows={3}
                    defaultValue={editingOneTimeExpense?.mail_info || ''}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    placeholder="Enter expense description"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Paid Amount *</label>
                    <input
                      type="number"
                      name="amount_owed"
                      step="0.01"
                      defaultValue={editingOneTimeExpense?.amount_owed || ''}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                      placeholder="0.00"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Date Paid *</label>
                    <input
                      type="date"
                      name="last_paid_date"
                      defaultValue={editingOneTimeExpense?.last_paid_date || ''}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Property (Optional)</label>
                  <select
                    name="property_id"
                    defaultValue={editingOneTimeExpense?.property_id || ''}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                  >
                    <option value="">None</option>
                    {properties.map((property) => (
                      <option key={property.id} value={property.id}>
                        {property.name} - {property.address}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-6 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowOneTimeModal(false)
                    setEditingOneTimeExpense(null)
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                >
                  {editingOneTimeExpense ? 'Update One-Time Expense' : 'Add One-Time Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
