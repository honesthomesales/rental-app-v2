'use client'

import { useEffect, useState } from 'react'
import { ProfitMetrics, PropertyProfitData } from '@/types/database'

export default function ProfitPage() {
  const [metrics, setMetrics] = useState<ProfitMetrics | null>(null)
  const [propertyData, setPropertyData] = useState<PropertyProfitData[]>([])
  const [loading, setLoading] = useState(true)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [monthlyMetrics, setMonthlyMetrics] = useState<any>(null)

  useEffect(() => {
    fetchMonthlyMetrics()
  }, [currentDate])

  const fetchProfitData = async () => {
    try {
      // Mock data for now
      const mockMetrics: ProfitMetrics = {
        grossCollected: 18000,
        effectiveGrossIncome: 18000,
        operatingExpenses: 4500,
        netOperatingIncome: 13500,
        cashFlowAfterDebt: 12000,
        collectionRate: 0.95,
        lateFeeYield: 0.02
      }

      const mockPropertyData: PropertyProfitData[] = [
        {
          property: {
            id: '1',
            name: '123 Main Street',
            address: '123 Main Street',
            city: 'Anytown',
            state: 'CA',
            zip_code: '12345'
          },
          scheduledRent: 2000,
          rentCollected: 1900,
          lateFees: 45,
          otherIncome: 0,
          effectiveGrossIncome: 1945,
          operatingExpenses: 500,
          netOperatingIncome: 1445,
          debtService: 300,
          cashFlowAfterDebt: 1145
        },
        {
          property: {
            id: '2',
            name: '456 Oak Avenue',
            address: '456 Oak Avenue',
            city: 'Anytown',
            state: 'CA',
            zip_code: '12345'
          },
          scheduledRent: 1200,
          rentCollected: 1200,
          lateFees: 0,
          otherIncome: 0,
          effectiveGrossIncome: 1200,
          operatingExpenses: 200,
          netOperatingIncome: 1000,
          debtService: 150,
          cashFlowAfterDebt: 850
        }
      ]

      setMetrics(mockMetrics)
      setPropertyData(mockPropertyData)
    } catch (error) {
      console.error('Error fetching profit data:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchMonthlyMetrics = async () => {
    try {
      const monthParam = currentDate.toISOString().slice(0, 7) // YYYY-MM format
      console.log('Fetching monthly metrics for:', monthParam)
      
      const response = await fetch(`/api/profit/metrics?month=${monthParam}`)
      if (response.ok) {
        const data = await response.json()
        console.log('Monthly metrics received:', data)
        console.log('Rent collected from API:', data?.oneTimeExpenseIncome?.income?.rentCollected)
        console.log('Expected rent from API:', data?.rentCollection?.expected)
        setMonthlyMetrics(data)
      } else {
        console.error('Failed to fetch monthly metrics:', response.status)
        const errorData = await response.json()
        console.error('Error details:', errorData)
      }
    } catch (error) {
      console.error('Error fetching monthly metrics:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (amount: number) => {
    return `$${Math.round(amount).toLocaleString()}`
  }

  const formatMonth = (date: Date) => {
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }

  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentDate(prev => {
      const newDate = new Date(prev)
      if (direction === 'prev') {
        newDate.setMonth(prev.getMonth() - 1)
      } else {
        newDate.setMonth(prev.getMonth() + 1)
      }
      return newDate
    })
  }

  const renderMetricsView = () => (
    <div className="space-y-6">
      {/* Calendar Header */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => navigateMonth('prev')}
              className="p-2 hover:bg-gray-100 rounded-lg"
              title="Previous month"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <input
              type="month"
              value={currentDate.toISOString().slice(0, 7)}
              onChange={(e) => {
                if (e.target.value) {
                  setCurrentDate(new Date(e.target.value + '-01'))
                }
              }}
              className="text-xl font-semibold text-gray-900 border-none bg-transparent cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 py-1"
            />
            <button
              onClick={() => navigateMonth('next')}
              className="p-2 hover:bg-gray-100 rounded-lg"
              title="Next month"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Three Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Fixed Expenses */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center mb-4">
            <div className="w-4 h-4 bg-red-500 rounded-full mr-3"></div>
            <h3 className="text-lg font-semibold text-gray-900">Fixed Expenses</h3>
          </div>
          
          <div className="space-y-4">
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="text-sm text-gray-600 mb-1">Insurance</div>
              <div className="text-2xl font-bold text-gray-900">
                {formatCurrency(monthlyMetrics?.fixedExpenses?.insurance || 0)}
              </div>
            </div>
            
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="text-sm text-gray-600 mb-1">Taxes</div>
              <div className="text-2xl font-bold text-gray-900">
                {formatCurrency(monthlyMetrics?.fixedExpenses?.taxes || 0)}
              </div>
            </div>
            
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="text-sm text-gray-600 mb-1">Total Payments</div>
              <div className="text-2xl font-bold text-gray-900">
                {formatCurrency(monthlyMetrics?.fixedExpenses?.totalPayments || 0)}
              </div>
            </div>
            
            <div className="bg-red-50 p-4 rounded-lg border border-red-200">
              <div className="text-sm text-gray-600 mb-1">Total Fixed Expenses</div>
              <div className="text-2xl font-bold text-red-600">
                {formatCurrency(monthlyMetrics?.fixedExpenses?.total || 0)}
              </div>
            </div>
          </div>
        </div>

        {/* 1 Time Expense and Income */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center mb-4">
            <div className="w-4 h-4 bg-orange-500 rounded-full mr-3"></div>
            <h3 className="text-lg font-semibold text-gray-900">1 Time Expense and Income</h3>
          </div>
          
          {/* Expenses Section */}
          <div className="mb-6">
            <div className="text-sm font-medium text-gray-700 mb-3">Expenses</div>
            <div className="bg-gray-50 p-3 rounded-lg">
              <div className="text-xs text-gray-600 mb-1">Other Expenses</div>
              <div className="text-lg font-bold text-gray-600">
                {formatCurrency(monthlyMetrics?.oneTimeExpenseIncome?.expenses?.otherExpenses || 0)}
              </div>
            </div>
          </div>
          
          {/* Income Section */}
          <div className="mb-6">
            <div className="text-sm font-medium text-gray-700 mb-3">Income</div>
            <div className="bg-green-50 p-3 rounded-lg">
              <div className="text-xs text-gray-600 mb-1">Misc Income</div>
              <div className="text-lg font-bold text-green-600">
                {formatCurrency(monthlyMetrics?.oneTimeExpenseIncome?.income?.miscIncome || 0)}
              </div>
            </div>
          </div>
          
          {/* Totals */}
          <div className="space-y-3 pt-3 border-t border-gray-200">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-gray-700">Total Income:</span>
              <span className="text-lg font-bold text-green-600">
                {formatCurrency((monthlyMetrics?.rentCollection?.collected || 0) + (monthlyMetrics?.oneTimeExpenseIncome?.income?.miscIncome || 0))}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-gray-700">Total Debt:</span>
              <span className="text-lg font-bold text-red-600">
                {formatCurrency(monthlyMetrics?.oneTimeExpenseIncome?.totalDebt || 0)}
              </span>
            </div>
          </div>
        </div>

        {/* Rent Collection */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center mb-4">
            <div className="w-4 h-4 bg-blue-500 rounded-full mr-3"></div>
            <h3 className="text-lg font-semibold text-gray-900">Rent Collection</h3>
          </div>
          
          {/* Gauge Chart */}
          <div className="flex justify-center mb-6">
            <div className="relative w-40 h-24">
              <svg className="w-40 h-24" viewBox="0 0 100 50">
                {/* Background arc */}
                <path
                  d="M 10 45 A 40 40 0 0 1 90 45"
                  stroke="#e5e7eb"
                  strokeWidth="8"
                  fill="none"
                  strokeLinecap="round"
                />
                {/* Progress arc - dynamic based on collection rate (use decimal 0-1) */}
                <path
                  d="M 10 45 A 40 40 0 0 1 90 45"
                  stroke="#eab308"
                  strokeWidth="8"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${(monthlyMetrics?.rentCollection?.collectionRateDecimal || 0) * 126}, 126`}
                />
                {/* Center dot */}
                <circle cx="50" cy="45" r="3" fill="#6b7280" />
                {/* Needle - rotated based on collection rate (use decimal 0-1) */}
                <line
                  x1="50"
                  y1="45"
                  x2="50"
                  y2="15"
                  stroke="#374151"
                  strokeWidth="2"
                  strokeLinecap="round"
                  transform={`rotate(${((monthlyMetrics?.rentCollection?.collectionRateDecimal || 0) * 180) - 90} 50 45)`}
                />
              </svg>
              <div className="absolute inset-0 flex items-end justify-center pb-2">
                <div className="text-center">
                  <div className="text-xs text-gray-600">Rent Collected</div>
                  <div className="text-lg font-bold text-gray-900">
                    {formatCurrency(monthlyMetrics?.rentCollection?.collected || 0)}
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Legend */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <div className="w-3 h-3 bg-green-500 rounded-full mr-2"></div>
                <span className="text-sm text-gray-600">Rent Collected</span>
              </div>
              <span className="text-sm font-medium text-gray-900">
                {formatCurrency(monthlyMetrics?.rentCollection?.collected || 0)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <div className="w-3 h-3 bg-yellow-500 rounded-full mr-2"></div>
                <span className="text-sm text-gray-600">Expected</span>
              </div>
              <span className="text-sm font-medium text-gray-900">
                {formatCurrency(monthlyMetrics?.rentCollection?.expected || 0)}
              </span>
            </div>
          </div>
          
          {/* Current Profit */}
          <div className="mt-6 pt-4 border-t border-gray-200">
            <div className="text-center">
              <div className="text-sm text-gray-600 mb-2">CURRENT PROFIT</div>
              {(() => {
                const totalIncome = (monthlyMetrics?.rentCollection?.collected || 0) + (monthlyMetrics?.oneTimeExpenseIncome?.income?.miscIncome || 0)
                const totalExpenses = (monthlyMetrics?.fixedExpenses?.total || 0) + (monthlyMetrics?.oneTimeExpenseIncome?.expenses?.otherExpenses || 0)
                const profit = totalIncome - totalExpenses
                return (
                  <div className={`text-6xl font-bold ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatCurrency(profit)}
                  </div>
                )
              })()}
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-white p-6 rounded-lg shadow">
                <div className="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
                <div className="h-8 bg-gray-200 rounded w-3/4"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Profit Analysis v2.1</h1>
      </div>


      {/* Monthly Metrics View */}
      {renderMetricsView()}

      {/* Detailed Income and Rent by Property */}
      <div className="bg-white rounded-lg shadow overflow-hidden mt-8">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Income and Rent Details - {formatMonth(currentDate)}</h2>
          <p className="text-sm text-gray-600 mt-1">Detailed breakdown by property for the selected month</p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky left-0 bg-gray-50 z-10">
                  Property
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Expected Rent
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Rent Collected
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Misc Income
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Total Income
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {monthlyMetrics?.propertyDetails?.map((property: any, index: number) => (
                <tr key={index} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap sticky left-0 bg-white z-10">
                    <div>
                      <div className="text-sm font-medium text-gray-900">
                        {property.property_name || 'Unknown Property'}
                      </div>
                      <div className="text-sm text-gray-500">
                        {property.property_address || ''}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatCurrency(property.expected_rent || 0)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatCurrency(property.rent_collected || 0)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatCurrency(property.misc_income || 0)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-green-600">
                    {formatCurrency((property.rent_collected || 0) + (property.misc_income || 0))}
                  </td>
                </tr>
              )) || (
                <tr>
                  <td colSpan={5} className="px-6 py-4 text-center text-sm text-gray-500">
                    No property data available for {formatMonth(currentDate)}
                  </td>
                </tr>
              )}
              {monthlyMetrics?.propertyDetails && monthlyMetrics.propertyDetails.length > 0 && (
                <tr className="bg-gray-100 font-semibold">
                  <td className="px-6 py-4 whitespace-nowrap sticky left-0 bg-gray-100 z-10">
                    TOTALS
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatCurrency(monthlyMetrics.propertyDetails.reduce((sum: number, p: any) => sum + (p.expected_rent || 0), 0))}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatCurrency(monthlyMetrics.propertyDetails.reduce((sum: number, p: any) => sum + (p.rent_collected || 0), 0))}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatCurrency(monthlyMetrics.propertyDetails.reduce((sum: number, p: any) => sum + (p.misc_income || 0), 0))}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-green-600">
                    {formatCurrency(monthlyMetrics.propertyDetails.reduce((sum: number, p: any) => sum + (p.rent_collected || 0) + (p.misc_income || 0), 0))}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
