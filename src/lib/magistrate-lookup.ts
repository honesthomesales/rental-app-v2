/**
 * Magistrate lookup utility for South Carolina counties
 * Determines magistrate district based on property address, zip code, and county
 */

interface MagistrateInfo {
  district: string
  courtAddress?: string
  notes?: string
}

/**
 * Lookup magistrate district based on county, city, and zip code
 * This is a basic lookup - you may need to refine based on actual magistrate district boundaries
 */
export function getMagistrateDistrict(
  county: string,
  city?: string,
  zipCode?: string
): string {
  // Normalize inputs
  const normalizedCounty = county?.toLowerCase().trim() || ''
  const normalizedCity = city?.toLowerCase().trim() || ''
  const normalizedZip = zipCode?.trim() || ''

  // Spartanburg County
  if (normalizedCounty === 'spartanburg' || normalizedCounty === 'spartanburg county') {
    // Spartanburg has multiple magistrate districts
    // Common areas: Spartanburg city, Greer, Boiling Springs, etc.
    if (normalizedCity.includes('greer') || normalizedZip.startsWith('296')) {
      return 'Magistrate District 5' // Common for Greer area
    }
    if (normalizedCity.includes('spartanburg') || normalizedZip.startsWith('293')) {
      return 'Magistrate District 1' // Common for Spartanburg city
    }
    if (normalizedCity.includes('boiling springs') || normalizedZip.startsWith('29316')) {
      return 'Magistrate District 3'
    }
    return 'Magistrate District 1' // Default for Spartanburg
  }

  // Greenville County
  if (normalizedCounty === 'greenville' || normalizedCounty === 'greenville county') {
    // Greenville has multiple districts
    if (normalizedCity.includes('greenville') || normalizedZip.startsWith('29601') || normalizedZip.startsWith('29605')) {
      return 'Magistrate District 2'
    }
    if (normalizedCity.includes('taylors') || normalizedZip.startsWith('29687')) {
      return 'Magistrate District 6'
    }
    return 'Magistrate District 2' // Default for Greenville
  }

  // Anderson County
  if (normalizedCounty === 'anderson' || normalizedCounty === 'anderson county') {
    if (normalizedCity.includes('anderson') || normalizedZip.startsWith('29621') || normalizedZip.startsWith('29624')) {
      return 'Magistrate District 3'
    }
    return 'Magistrate District 3' // Default for Anderson
  }

  // Cherokee County
  if (normalizedCounty === 'cherokee' || normalizedCounty === 'cherokee county') {
    if (normalizedCity.includes('gaffney') || normalizedZip.startsWith('29340')) {
      return 'Magistrate District 1'
    }
    return 'Magistrate District 1' // Default for Cherokee
  }

  // Union County
  if (normalizedCounty === 'union' || normalizedCounty === 'union county') {
    if (normalizedCity.includes('union') || normalizedZip.startsWith('29379')) {
      return 'Magistrate District 1'
    }
    return 'Magistrate District 1' // Default for Union
  }

  // Saluda County
  if (normalizedCounty === 'saluda' || normalizedCounty === 'saluda county') {
    if (normalizedCity.includes('saluda') || normalizedZip.startsWith('29138')) {
      return 'Magistrate District 1'
    }
    return 'Magistrate District 1' // Default for Saluda
  }

  // Default: Return generic magistrate reference
  return 'Magistrate'
}

/**
 * Get magistrate court address based on county and district
 */
export function getMagistrateCourtAddress(county: string, district?: string): string {
  const normalizedCounty = county?.toLowerCase().trim() || ''

  if (normalizedCounty.includes('spartanburg')) {
    return '180 Magnolia Street, Spartanburg, SC 29306'
  }
  if (normalizedCounty.includes('greenville')) {
    return '305 East North Street, Greenville, SC 29601'
  }
  if (normalizedCounty.includes('anderson')) {
    return '101 South Main Street, Anderson, SC 29624'
  }
  if (normalizedCounty.includes('cherokee')) {
    return '129 North Limestone Street, Gaffney, SC 29340'
  }
  if (normalizedCounty.includes('union')) {
    return '210 West Main Street, Union, SC 29379'
  }
  if (normalizedCounty.includes('saluda')) {
    return '100 North Church Street, Saluda, SC 29138'
  }

  return ''
}
