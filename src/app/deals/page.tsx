'use client'

import { useEffect, useState, useMemo } from 'react'
import { Deal } from '@/types/database'
import { PlusIcon, PencilIcon, TrashIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline'

type SortField = 'address' | 'seller_name' | 'sell_price' | 'date_purchased' | 'Soteris_$'
type SortDirection = 'asc' | 'desc'

export default function DealsPage() {
  const [allDeals, setAllDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null)
  const [sortField, setSortField] = useState<SortField>('date_purchased')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    fetchDeals()
  }, [])

  const fetchDeals = async () => {
    try {
      setLoading(true)
      const url = searchTerm ? `/api/deals?search=${encodeURIComponent(searchTerm)}` : '/api/deals'
      const response = await fetch(url)
      
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to fetch deals')
      }
      
      const data = await response.json()
      setAllDeals(data || [])
    } catch (error) {
      console.error('Error fetching deals:', error)
      setAllDeals([])
    } finally {
      setLoading(false)
    }
  }

  // Update search when searchTerm changes
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      fetchDeals()
    }, 300) // Debounce search

    return () => clearTimeout(timeoutId)
  }, [searchTerm])

  // Compute filtered and sorted deals using useMemo
  const deals = useMemo(() => {
    let filtered = [...allDeals]

    // Apply sorting
    filtered.sort((a, b) => {
      let aValue: any
      let bValue: any

      switch (sortField) {
        case 'address':
          aValue = (a.address || '').toLowerCase()
          bValue = (b.address || '').toLowerCase()
          break
        case 'seller_name':
          aValue = (a.seller_name || '').toLowerCase()
          bValue = (b.seller_name || '').toLowerCase()
          break
        case 'sell_price':
          aValue = a.sell_price || 0
          bValue = b.sell_price || 0
          break
        case 'date_purchased':
          aValue = new Date(a.date_purchased).getTime()
          bValue = new Date(b.date_purchased).getTime()
          break
        case 'Soteris_$':
          aValue = a["Soteris_$"] || 0
          bValue = b["Soteris_$"] || 0
          break
        default:
          return 0
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1
      return 0
    })

    return filtered
  }, [allDeals, sortField, sortDirection])

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

  const handleAddDeal = () => {
    setShowAddModal(true)
  }

  const handleEditDeal = (deal: Deal) => {
    setEditingDeal(deal)
  }

  const handleDeleteDeal = async (deal: Deal) => {
    if (!confirm(`Are you sure you want to delete the deal for ${deal.address}?`)) {
      return
    }

    try {
      const response = await fetch(`/api/deals?id=${deal.id}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to delete deal')
      }

      await fetchDeals()
    } catch (error) {
      console.error('Error deleting deal:', error)
      alert('Failed to delete deal. Please try again.')
    }
  }

  const handleCreateDeal = async (dealData: Partial<Deal>) => {
    try {
      const response = await fetch('/api/deals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(dealData)
      })

      const responseData = await response.json()

      if (!response.ok) {
        console.error('Error creating deal:', responseData)
        const errorMessage = responseData.details || responseData.error || responseData.hint || 'Failed to create deal'
        throw new Error(errorMessage)
      }

      await fetchDeals()
      setShowAddModal(false)
    } catch (error) {
      console.error('Error creating deal:', error)
      alert(error instanceof Error ? error.message : 'Failed to create deal. Please try again.')
    }
  }

  const handleSaveDeal = async (dealData: Partial<Deal>) => {
    if (!editingDeal) return

    try {
      const response = await fetch('/api/deals', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: editingDeal.id,
          ...dealData
        })
      })

      const responseData = await response.json()

      if (!response.ok) {
        console.error('Error updating deal:', responseData)
        const errorMessage = responseData.details || responseData.error || responseData.hint || 'Failed to update deal'
        throw new Error(errorMessage)
      }

      await fetchDeals()
      setEditingDeal(null)
    } catch (error) {
      console.error('Error updating deal:', error)
      alert(error instanceof Error ? error.message : 'Failed to update deal. Please try again.')
    }
  }

  const formatCurrency = (amount: number | undefined | null) => {
    if (amount === undefined || amount === null) return 'N/A'
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount)
  }

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return 'N/A'
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="bg-white p-6 rounded-lg shadow">
                <div className="h-4 bg-gray-200 rounded w-1/3 mb-2"></div>
                <div className="h-3 bg-gray-200 rounded w-1/2"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Deals</h1>
          <p className="text-gray-600 mt-2">
            Manage your property deals {searchTerm && `(${deals.length} of ${allDeals.length})`}
            {!searchTerm && `(${allDeals.length})`}
          </p>
        </div>
        <button
          onClick={handleAddDeal}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center"
        >
          <PlusIcon className="h-5 w-5 mr-2" />
          Add Deal
        </button>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">All Deals</h2>
            <div className="flex items-center space-x-4">
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search deals..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
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
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('seller_name')}
                >
                  <div className="flex items-center">
                    Seller Name
                    {sortField === 'seller_name' && (
                      <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Seller Phone
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('sell_price')}
                >
                  <div className="flex items-center">
                    Sell Price
                    {sortField === 'sell_price' && (
                      <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('date_purchased')}
                >
                  <div className="flex items-center">
                    Date Purchased
                    {sortField === 'date_purchased' && (
                      <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('Soteris_$')}
                >
                  <div className="flex items-center">
                    Soteris $
                    {sortField === 'Soteris_$' && (
                      <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Notes
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {deals.map((deal) => (
                <tr key={deal.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {deal.address}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {deal.seller_name || 'N/A'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {deal.seller_phone || 'N/A'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatCurrency(deal.sell_price)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatDate(deal.date_purchased)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatCurrency(deal["Soteris_$"])}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900 max-w-xs truncate">
                    {deal.notes || 'N/A'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <div className="flex justify-end space-x-2">
                      <button
                        onClick={() => handleEditDeal(deal)}
                        className="text-blue-600 hover:text-blue-900"
                        title="Edit Deal"
                      >
                        <PencilIcon className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteDeal(deal)}
                        className="text-red-600 hover:text-red-900"
                        title="Delete Deal"
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

      {deals.length === 0 && (
        <div className="text-center py-12">
          <h3 className="text-lg font-medium text-gray-900 mb-2">No deals found</h3>
          <p className="text-gray-500 mb-4">Get started by adding your first deal.</p>
          <button
            onClick={handleAddDeal}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            Add Deal
          </button>
        </div>
      )}

      {/* Add Deal Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Add Deal</h2>
            <form onSubmit={(e) => {
              e.preventDefault()
              const formData = new FormData(e.currentTarget)
              const dealData = {
                address: formData.get('address') as string,
                seller_name: formData.get('seller_name') as string,
                seller_phone: formData.get('seller_phone') as string,
                sell_price: formData.get('sell_price') as string,
                date_purchased: formData.get('date_purchased') as string,
                "Soteris_$": formData.get('Soteris_$') as string,
                notes: formData.get('notes') as string
              }
              handleCreateDeal(dealData)
            }}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Address *</label>
                  <input
                    type="text"
                    name="address"
                    required
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Seller Name</label>
                    <input
                      type="text"
                      name="seller_name"
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Seller Phone</label>
                    <input
                      type="text"
                      name="seller_phone"
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Sell Price *</label>
                    <input
                      type="number"
                      name="sell_price"
                      required
                      step="0.01"
                      min="0"
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Date Purchased *</label>
                    <input
                      type="date"
                      name="date_purchased"
                      required
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Soteris $</label>
                  <input
                    type="number"
                    name="Soteris_$"
                    step="0.01"
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Notes</label>
                  <textarea
                    name="notes"
                    rows={3}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                </div>
              </div>
              <div className="flex justify-end space-x-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Create Deal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Deal Modal */}
      {editingDeal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Edit Deal</h2>
            <form onSubmit={(e) => {
              e.preventDefault()
              const formData = new FormData(e.currentTarget)
              const dealData = {
                address: formData.get('address') as string,
                seller_name: formData.get('seller_name') as string,
                seller_phone: formData.get('seller_phone') as string,
                sell_price: formData.get('sell_price') as string,
                date_purchased: formData.get('date_purchased') as string,
                "Soteris_$": formData.get('Soteris_$') as string,
                notes: formData.get('notes') as string
              }
              handleSaveDeal(dealData)
            }}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Address *</label>
                  <input
                    type="text"
                    name="address"
                    defaultValue={editingDeal.address}
                    required
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Seller Name</label>
                    <input
                      type="text"
                      name="seller_name"
                      defaultValue={editingDeal.seller_name || ''}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Seller Phone</label>
                    <input
                      type="text"
                      name="seller_phone"
                      defaultValue={editingDeal.seller_phone || ''}
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Sell Price *</label>
                    <input
                      type="number"
                      name="sell_price"
                      defaultValue={editingDeal.sell_price}
                      required
                      step="0.01"
                      min="0"
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Date Purchased *</label>
                    <input
                      type="date"
                      name="date_purchased"
                      defaultValue={editingDeal.date_purchased}
                      required
                      className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Soteris $</label>
                  <input
                    type="number"
                    name="Soteris_$"
                    defaultValue={editingDeal["Soteris_$"] || ''}
                    step="0.01"
                    min="0"
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Notes</label>
                  <textarea
                    name="notes"
                    defaultValue={editingDeal.notes || ''}
                    rows={3}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                </div>
              </div>
              <div className="flex justify-end space-x-3 mt-6">
                <button
                  type="button"
                  onClick={() => setEditingDeal(null)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

