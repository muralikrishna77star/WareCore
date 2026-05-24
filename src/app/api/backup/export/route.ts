import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { dataToCSV, getAllTableData, getPointInTimeBackup } from '@/lib/backup/backup.service'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  try {
    // Verify authentication
    const session = await verifySessionCookie(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const table = searchParams.get('table')
    const pointInTime = searchParams.get('pointInTime')
    const format = searchParams.get('format') || 'csv' // csv or json

    if (!table) {
      return NextResponse.json(
        { error: 'Table name is required' },
        { status: 400 }
      )
    }

    // Fetch data
    let data: any[] = []
    if (pointInTime) {
      const backupData = await getPointInTimeBackup(pointInTime, [table])
      data = backupData[table] || []
    } else {
      const allData = await getAllTableData([table])
      data = allData[table] || []
    }

    // Format response
    if (format === 'json') {
      return NextResponse.json({
        table,
        timestamp: new Date().toISOString(),
        count: data.length,
        data,
      })
    }

    // CSV format
    const csv = dataToCSV(data, table)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `${table}_${timestamp}.csv`

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    console.error('Error in GET /api/backup/export:', error)
    return NextResponse.json(
      { error: 'Failed to export data', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const session = await verifySessionCookie(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { tables, pointInTime, format } = body

    if (!tables || !Array.isArray(tables) || tables.length === 0) {
      return NextResponse.json(
        { error: 'Tables array is required' },
        { status: 400 }
      )
    }

    // Fetch data
    let allData: { [table: string]: any[] } = {}
    if (pointInTime) {
      allData = await getPointInTimeBackup(pointInTime, tables)
    } else {
      allData = await getAllTableData(tables)
    }

    // Format response
    if (format === 'json') {
      return NextResponse.json({
        timestamp: new Date().toISOString(),
        tables: Object.keys(allData),
        totalRows: Object.values(allData).reduce((sum, t) => sum + t.length, 0),
        data: allData,
      })
    }

    // CSV format - combine all tables with separators
    const csvParts: string[] = []
    for (const table of tables) {
      const data = allData[table] || []
      csvParts.push(`\n\n=== TABLE: ${table} ===\n`)
      csvParts.push(dataToCSV(data, table))
    }

    const csv = csvParts.join('\n')
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `backup_all_tables_${timestamp}.csv`

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    console.error('Error in POST /api/backup/export:', error)
    return NextResponse.json(
      { error: 'Failed to export data', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}
