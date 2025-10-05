'use client'

import { useEffect, useState } from 'react'
import { ProfitMetrics, PropertyProfitData } from '@/types/database'
import { ChartBarIcon, CurrencyDollarIcon, ArrowTrendingUpIcon, ArrowTrendingDownIcon } from '@heroicons/react/24/outline'

export default function ProfitPage() {
  const [metrics, setMetrics] = useState<ProfitMetrics | null>(null)
  const [propertyData, setPropertyData] = useState<PropertyProfitData[]>([])
  const [loading, setLoading] = useState(true)
  const [dateRange, setDateRange] = useState('ytd')
  const [granularity, setGranularity] = useState('monthly')
  const [includeDebt, setIncludeDebt] = useState(false)
  const [showMetrics, setShowMetrics] = useState(true)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [monthlyMetrics, setMonthlyMetrics] = useState<any>(null)

  useEffect(() => {
    fetchProfitData()
  }, [dateRange, granularity, includeDebt])

  useEffect(() => {
    if (showMetrics) {
      fetchMonthlyMetrics()
    }
  }, [currentDate, showMetrics])

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
    }
  }

  const formatCurrency = (amount: number) => {
    return `$${amount.toLocaleString()}`
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
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h2 className="text-xl font-semibold text-gray-900">
              {formatMonth(currentDate)}
            </h2>
            <button
              onClick={() => navigateMonth('next')}
              className="p-2 hover:bg-gray-100 rounded-lg"
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
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-yellow-50 p-3 rounded-lg">
                <div className="text-xs text-gray-600 mb-1">Repairs</div>
                <div className="text-lg font-bold text-orange-600">
                  {formatCurrency(monthlyMetrics?.oneTimeExpenseIncome?.expenses?.repairs || 0)}
                </div>
              </div>
              <div className="bg-gray-50 p-3 rounded-lg">
                <div className="text-xs text-gray-600 mb-1">Other Expenses</div>
                <div className="text-lg font-bold text-gray-600">
                  {formatCurrency(monthlyMetrics?.oneTimeExpenseIncome?.expenses?.otherExpenses || 0)}
                </div>
              </div>
            </div>
          </div>
          
          {/* Income Section */}
          <div className="mb-6">
            <div className="text-sm font-medium text-gray-700 mb-3">Income</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-green-50 p-3 rounded-lg">
                <div className="text-xs text-gray-600 mb-1">Misc Income</div>
                <div className="text-lg font-bold text-green-600">
                  {formatCurrency(monthlyMetrics?.oneTimeExpenseIncome?.income?.miscIncome || 0)}
                </div>
              </div>
              <div className="bg-blue-50 p-3 rounded-lg">
                <div className="text-xs text-gray-600 mb-1">Rent Collected</div>
                <div className="text-lg font-bold text-blue-600">
                  {formatCurrency(monthlyMetrics?.oneTimeExpenseIncome?.income?.rentCollected || 0)}
                </div>
              </div>
            </div>
          </div>
          
          {/* Totals */}
          <div className="space-y-3 pt-3 border-t border-gray-200">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-gray-700">Total Income:</span>
              <span className="text-lg font-bold text-green-600">
                {formatCurrency(monthlyMetrics?.oneTimeExpenseIncome?.totalIncome || 0)}
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
                {/* Progress arc - dynamic based on collection rate */}
                <path
                  d="M 10 45 A 40 40 0 0 1 90 45"
                  stroke="#eab308"
                  strokeWidth="8"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${(monthlyMetrics?.rentCollection?.collectionRate || 0) * 1.26}, 126`}
                />
                {/* Center dot */}
                <circle cx="50" cy="45" r="3" fill="#6b7280" />
                {/* Needle - rotated based on collection rate */}
                <line
                  x1="50"
                  y1="45"
                  x2="50"
                  y2="15"
                  stroke="#374151"
                  strokeWidth="2"
                  strokeLinecap="round"
                  transform={`rotate(${((monthlyMetrics?.rentCollection?.collectionRate || 0) * 180) - 90} 50 45)`}
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
        <h1 className="text-2xl font-bold text-gray-900">Profit Analysis</h1>
        <p className="text-gray-600 mt-2">Income vs expenses → NOI → cash flow by Property, Month, and Portfolio</p>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="flex flex-wrap items-center gap-4">
          {/* Metrics Toggle */}
          <div className="flex items-center">
            <input
              type="checkbox"
              id="showMetrics"
              checked={showMetrics}
              onChange={(e) => setShowMetrics(e.target.checked)}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="showMetrics" className="ml-2 text-sm text-gray-700 font-medium">
              Show Monthly Metrics
            </label>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date Range</label>
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="mtd">MTD</option>
              <option value="qtd">QTD</option>
              <option value="ytd">YTD</option>
              <option value="last12m">Last 12M</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Granularity</label>
            <select
              value={granularity}
              onChange={(e) => setGranularity(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="annual">Annual</option>
            </select>
          </div>
          
          <div className="flex items-center">
            <input
              type="checkbox"
              id="includeDebt"
              checked={includeDebt}
              onChange={(e) => setIncludeDebt(e.target.checked)}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="includeDebt" className="ml-2 text-sm text-gray-700">
              Include Debt Service
            </label>
          </div>
        </div>
      </div>

      {/* Show Metrics View if enabled */}
      {showMetrics && renderMetricsView()}

      {/* Key Performance Indicators */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <CurrencyDollarIcon className="h-8 w-8 text-green-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">EGI</p>
              <p className="text-2xl font-semibold text-gray-900">
                ${metrics?.effectiveGrossIncome?.toLocaleString() || 0}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <ArrowTrendingDownIcon className="h-8 w-8 text-red-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">OPEX</p>
              <p className="text-2xl font-semibold text-gray-900">
                ${metrics?.operatingExpenses?.toLocaleString() || 0}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <ArrowTrendingUpIcon className="h-8 w-8 text-blue-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">NOI</p>
              <p className="text-2xl font-semibold text-gray-900">
                ${metrics?.netOperatingIncome?.toLocaleString() || 0}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <ChartBarIcon className="h-8 w-8 text-purple-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">CFAD</p>
              <p className="text-2xl font-semibold text-gray-900">
                ${metrics?.cashFlowAfterDebt?.toLocaleString() || 0}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="h-8 w-8 bg-blue-100 rounded-full flex items-center justify-center">
                <span className="text-blue-600 font-bold text-sm">%</span>
              </div>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Collection Rate</p>
              <p className="text-2xl font-semibold text-gray-900">
                {((metrics?.collectionRate || 0) * 100).toFixed(1)}%
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="h-8 w-8 bg-yellow-100 rounded-full flex items-center justify-center">
                <span className="text-yellow-600 font-bold text-sm">$</span>
              </div>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Late Fee Yield</p>
              <p className="text-2xl font-semibold text-gray-900">
                {((metrics?.lateFeeYield || 0) * 100).toFixed(1)}%
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Property Performance Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Property Performance</h2>
          <p className="text-sm text-gray-600 mt-1">Financial metrics by property</p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky left-0 bg-gray-50 z-10">
                  Property
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Scheduled Rent
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Rent Collected
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Late Fees
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Other Income
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  EGI
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  OPEX
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  NOI
                </th>
                {includeDebt && (
                  <>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Debt Service
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      CFAD
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {propertyData.map((property, index) => (
                <tr key={index} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap sticky left-0 bg-white z-10">
                    <div>
                      <div className="text-sm font-medium text-gray-900">
                        {property.property.name}
                      </div>
                      <div className="text-sm text-gray-500">
                        {property.property.address}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    ${property.scheduledRent.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    ${property.rentCollected.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    ${property.lateFees.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    ${property.otherIncome.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    ${property.effectiveGrossIncome.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    ${property.operatingExpenses.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    ${property.netOperatingIncome.toLocaleString()}
                  </td>
                  {includeDebt && (
                    <>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        ${property.debtService.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        ${property.cashFlowAfterDebt.toLocaleString()}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Charts Placeholder */}
      <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">NOI Trend</h3>
          <div className="h-64 bg-gray-100 rounded-lg flex items-center justify-center">
            <p className="text-gray-500">Chart will be implemented here</p>
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">EGI vs OPEX</h3>
          <div className="h-64 bg-gray-100 rounded-lg flex items-center justify-center">
            <p className="text-gray-500">Chart will be implemented here</p>
          </div>
        </div>
      </div>

      {/* Export Options */}
      <div className="mt-8 flex justify-end">
        <div className="flex space-x-3">
          <button className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
            Export CSV
          </button>
          <button className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
            Export XLSX
          </button>
        </div>
      </div>
    </div>
  )
}
