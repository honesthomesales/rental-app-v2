import {
  classifyFetchFailure,
  isGenuineEmptyState,
  logoutRedirectPath,
  resolveProtectedDataView,
  shouldRunProtectedQueries,
  type AuthStatus,
} from '@/lib/auth/session-state'

describe('mobile auth hotfix — session gating', () => {
  it('does not run protected queries while auth is loading', () => {
    expect(shouldRunProtectedQueries('loading')).toBe(false)
  })

  it('runs protected queries only when authenticated', () => {
    expect(shouldRunProtectedQueries('authenticated')).toBe(true)
    expect(shouldRunProtectedQueries('unauthenticated')).toBe(false)
    expect(shouldRunProtectedQueries('session_error')).toBe(false)
  })

  it('missing session shows sign-in required, not empty leases', () => {
    const view = resolveProtectedDataView({
      authStatus: 'unauthenticated',
      loading: false,
      httpStatus: null,
      networkError: false,
      itemCount: 0,
    })
    expect(view.kind).toBe('sign_in_required')
    expect(isGenuineEmptyState(view)).toBe(false)
    expect(view.kind === 'empty' ? view.message : '').not.toBe(
      'No active leases found',
    )
  })

  it('expired/session error shows session expired, not zeros/empty', () => {
    const view = resolveProtectedDataView({
      authStatus: 'session_error',
      loading: false,
      httpStatus: null,
      networkError: false,
      itemCount: 0,
    })
    expect(view.kind).toBe('session_expired')
    expect(view.message).toContain('Session expired')
    expect(isGenuineEmptyState(view)).toBe(false)
  })

  it('lease query waits for auth initialization', () => {
    const view = resolveProtectedDataView({
      authStatus: 'loading',
      loading: true,
      httpStatus: null,
      networkError: false,
      itemCount: 0,
    })
    expect(view.kind).toBe('auth_pending')
    expect(view.message).toBe('Checking sign-in…')
  })

  it('anonymous RLS / 401 does not display No active leases found', () => {
    const view = resolveProtectedDataView({
      authStatus: 'authenticated',
      loading: false,
      httpStatus: 401,
      networkError: false,
      itemCount: 0,
    })
    expect(view.kind).toBe('session_expired')
    expect(isGenuineEmptyState(view)).toBe(false)
  })

  it('401 does not display zero or empty data', () => {
    expect(classifyFetchFailure(401, false)).toBe('session_expired')
    const view = resolveProtectedDataView({
      authStatus: 'authenticated',
      loading: false,
      httpStatus: 401,
      networkError: false,
      itemCount: 0,
    })
    expect(view.kind).not.toBe('empty')
    expect(view.kind).not.toBe('ready')
  })

  it('403 does not display zero or empty data', () => {
    expect(classifyFetchFailure(403, false)).toBe('access_denied')
    const view = resolveProtectedDataView({
      authStatus: 'authenticated',
      loading: false,
      httpStatus: 403,
      networkError: false,
      itemCount: 0,
    })
    expect(view.kind).toBe('access_denied')
    expect(isGenuineEmptyState(view)).toBe(false)
  })

  it('network failure shows retry-capable unable/network state', () => {
    const view = resolveProtectedDataView({
      authStatus: 'authenticated',
      loading: false,
      httpStatus: null,
      networkError: true,
      itemCount: 0,
    })
    expect(view.kind).toBe('network_failure')
    expect(view.message).toMatch(/Unable to load/)
  })

  it('genuine authenticated zero leases displays No active leases found', () => {
    const view = resolveProtectedDataView({
      authStatus: 'authenticated',
      loading: false,
      httpStatus: 200,
      networkError: false,
      itemCount: 0,
      emptyMessage: 'No active leases found',
    })
    expect(view.kind).toBe('empty')
    expect(view.message).toBe('No active leases found')
    expect(isGenuineEmptyState(view)).toBe(true)
  })

  it('valid authenticated response with leases is ready', () => {
    const view = resolveProtectedDataView({
      authStatus: 'authenticated',
      loading: false,
      httpStatus: 200,
      networkError: false,
      itemCount: 12,
    })
    expect(view.kind).toBe('ready')
  })

  it('logout redirects to real sign-in route, never a missing path', () => {
    expect(logoutRedirectPath()).toBe('/login')
    expect(logoutRedirectPath()).not.toBe('/logout')
  })

  it('covers all explicit auth states', () => {
    const statuses: AuthStatus[] = [
      'loading',
      'authenticated',
      'unauthenticated',
      'session_error',
    ]
    for (const status of statuses) {
      const view = resolveProtectedDataView({
        authStatus: status,
        loading: status === 'loading',
        httpStatus: status === 'authenticated' ? 200 : null,
        networkError: false,
        itemCount: status === 'authenticated' ? 1 : 0,
      })
      expect(view.kind).toBeTruthy()
    }
  })

  it('failed refresh / session_error is distinct from empty leases', () => {
    const expired = resolveProtectedDataView({
      authStatus: 'session_error',
      loading: false,
      httpStatus: null,
      networkError: false,
      itemCount: 0,
    })
    const empty = resolveProtectedDataView({
      authStatus: 'authenticated',
      loading: false,
      httpStatus: 200,
      networkError: false,
      itemCount: 0,
    })
    expect(expired.kind).toBe('session_expired')
    expect(empty.kind).toBe('empty')
    expect(expired.kind).not.toBe(empty.kind)
  })
})
