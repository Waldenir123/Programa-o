import React, { useMemo } from 'react';
import { ScheduleData, RenderableRow, Status, STATUS_CLASS_MAP, DynamicColumn } from '../state/types';
import { formatDate, getDayAbbr, getWeek, isBrazilianHoliday } from '../utils/dataUtils';

// Simplified version of flattening, as we don't need all complex properties for comparison
const flattenComparisonData = (data: ScheduleData): RenderableRow[] => {
    if (!data) return [];
    const rows: any[] = [];
    let wbsGroup = 1;
    data.forEach(group => {
        let wbsTask = 1;
        group.tarefas.forEach(task => {
            let wbsActivity = 1;
            task.activities.forEach(activity => {
                rows.push({
                    group, task, activity, wbsId: `${wbsGroup}.${wbsTask}.${wbsActivity}`
                });
                wbsActivity++;
            });
            wbsTask++;
        });
        wbsGroup++;
    });
    return rows;
};

export const ComparisonView: React.FC<{
    savedPlan: ScheduleData | null;
    liveData: ScheduleData;
    dates: Date[];
    columnWidths: number[];
    onResizeStart: (columnIndex: number, e: React.MouseEvent) => void;
    stickyColumnPositions: number[];
    title: string;
    dynamicColumns: DynamicColumn[];
}> = ({ savedPlan, liveData, dates, columnWidths, onResizeStart, stickyColumnPositions, title, dynamicColumns }) => {

    const flatSavedPlan = useMemo(() => flattenComparisonData(savedPlan || []), [savedPlan]);
    const flatLiveData = useMemo(() => flattenComparisonData(liveData), [liveData]);

    const dynamicColumnsBefore = useMemo(() => (dynamicColumns || []).filter(c => c.position !== 'after'), [dynamicColumns]);
    const dynamicColumnsAfter = useMemo(() => (dynamicColumns || []).filter(c => c.position === 'after'), [dynamicColumns]);

    const headerNames = useMemo(() => {
        return [
            'ID',
            ...dynamicColumnsBefore.map(c => c.name),
            'TAREFA PRINCIPAL',
            ...dynamicColumnsAfter.map(c => c.name),
            'ATIVIDADE',
            'SETOR',
            'PLANO'
        ];
    }, [dynamicColumnsBefore, dynamicColumnsAfter]);

    const weekSpans = useMemo(() => {
        if (dates.length === 0) return [];
        const spans: { week: number; count: number }[] = [];
        if (dates.length > 0) {
            let currentWeek = getWeek(dates[0]);
            let count = 0;
            dates.forEach(date => {
                const week = getWeek(date);
                if (week === currentWeek) {
                    count++;
                } else {
                    spans.push({ week: currentWeek, count });
                    currentWeek = week;
                    count = 1;
                }
            });
            spans.push({ week: currentWeek, count });
        }
        return spans;
    }, [dates]);

    return (
        <div className="comparison-view">
             <div className="view-header">
                <h2>Comparativo: Planejado vs. Realizado</h2>
            </div>
            <div className="table-wrapper">
                 <table className="schedule-table" style={{ width: columnWidths.reduce((a, b) => a + b, 0) }}>
                    <thead>
                        <tr>
                            {headerNames.map((header, index) => {
                                const isVisible = columnWidths[index] !== 0;
                                return (
                                    <th 
                                        key={header} 
                                        rowSpan={3} 
                                        style={{ 
                                            width: columnWidths[index], 
                                            left: stickyColumnPositions[index],
                                            display: isVisible ? 'table-cell' : 'none'
                                        }} 
                                        className={`col-sticky col-sticky-${index + 1}`}
                                    >
                                        <div className="header-content"><span>{header}</span></div>
                                        <div className="resize-handle" onMouseDown={(e) => onResizeStart(index, e)}></div>
                                    </th>
                                );
                            })}
                            {weekSpans.map(span => (
                                <th key={`week-${span.week}`} colSpan={span.count} className="week-header">
                                    Semana {span.week}
                                </th>
                            ))}
                        </tr>
                        <tr>
                            {dates.map(date => {
                                const dayAbbr = getDayAbbr(date);
                                const isWeekend = dayAbbr === 'SÁB' || dayAbbr === 'DOM';
                                const weekendClass = isWeekend ? 'saturday-col' : '';
                                return <th key={`day-${formatDate(date)}`} className={weekendClass}>{dayAbbr}</th>;
                            })}
                        </tr>
                        <tr>
                            {dates.map(date => {
                                const dayAbbr = getDayAbbr(date);
                                const isWeekend = dayAbbr === 'SÁB' || dayAbbr === 'DOM';
                                const weekendClass = isWeekend ? 'saturday-col' : '';
                                return <th key={`date-${formatDate(date)}`} className={weekendClass}>{date.getUTCDate()}</th>;
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {flatLiveData.map((liveRow, index) => {
                             const savedRow = flatSavedPlan.find(p => p.activity.name === liveRow.activity.name && p.task.title === liveRow.task.title);

                             return (
                                <React.Fragment key={liveRow.activity.id}>
                                <tr className="planned-row">
                                    <td 
                                        className="col-sticky col-sticky-1" 
                                        style={{ 
                                            width: columnWidths[0], 
                                            left: stickyColumnPositions[0],
                                            display: columnWidths[0] !== 0 ? 'table-cell' : 'none'
                                        }}
                                    >
                                        {liveRow.wbsId}
                                    </td>
                                    {dynamicColumnsBefore.map((col, idx) => {
                                        const colIdx = idx + 1;
                                        return (
                                            <td 
                                                key={col.id} 
                                                className={`col-sticky col-sticky-${colIdx + 1}`} 
                                                style={{ 
                                                    width: columnWidths[colIdx], 
                                                    left: stickyColumnPositions[colIdx],
                                                    display: columnWidths[colIdx] !== 0 ? 'table-cell' : 'none'
                                                }}
                                            >
                                                {liveRow.group.customValues?.[col.id] || ''}
                                            </td>
                                        );
                                    })}
                                    <td 
                                        className={`col-sticky col-sticky-${dynamicColumnsBefore.length + 2}`} 
                                        style={{ 
                                            width: columnWidths[dynamicColumnsBefore.length + 1], 
                                            left: stickyColumnPositions[dynamicColumnsBefore.length + 1],
                                            display: columnWidths[dynamicColumnsBefore.length + 1] !== 0 ? 'table-cell' : 'none'
                                        }}
                                    >
                                        {liveRow.task.title}
                                    </td>
                                    {dynamicColumnsAfter.map((col, idx) => {
                                        const colIdx = dynamicColumnsBefore.length + 2 + idx;
                                        return (
                                            <td 
                                                key={col.id} 
                                                className={`col-sticky col-sticky-${colIdx + 1}`} 
                                                style={{ 
                                                    width: columnWidths[colIdx], 
                                                    left: stickyColumnPositions[colIdx],
                                                    display: columnWidths[colIdx] !== 0 ? 'table-cell' : 'none'
                                                }}
                                            >
                                                {liveRow.group.customValues?.[col.id] || ''}
                                            </td>
                                        );
                                    })}
                                    <td 
                                        className={`col-sticky col-sticky-${dynamicColumns.length + 3}`} 
                                        style={{ 
                                            width: columnWidths[dynamicColumns.length + 2], 
                                            left: stickyColumnPositions[dynamicColumns.length + 2],
                                            display: columnWidths[dynamicColumns.length + 2] !== 0 ? 'table-cell' : 'none'
                                        }}
                                    >
                                        {liveRow.activity.name}
                                    </td>
                                    <td 
                                        className={`col-sticky col-sticky-${dynamicColumns.length + 4}`} 
                                        style={{ 
                                            width: columnWidths[dynamicColumns.length + 3], 
                                            left: stickyColumnPositions[dynamicColumns.length + 3],
                                            display: columnWidths[dynamicColumns.length + 3] !== 0 ? 'table-cell' : 'none'
                                        }}
                                    >
                                        {liveRow.activity.sector || ''}
                                    </td>
                                    <td 
                                        className={`col-sticky col-sticky-${dynamicColumns.length + 5} comparison-label-cell`} 
                                        style={{ 
                                            width: columnWidths[dynamicColumns.length + 4], 
                                            left: stickyColumnPositions[dynamicColumns.length + 4],
                                            display: columnWidths[dynamicColumns.length + 4] !== 0 ? 'table-cell' : 'none'
                                        }}
                                    >
                                        Planejado
                                    </td>
                                    {dates.map(date => {
                                        const dateStr = formatDate(date);
                                        const status = savedRow?.activity.schedule[dateStr];
                                        return <td key={dateStr} className={`status-cell ${status ? STATUS_CLASS_MAP[status] : ''} ${getDayAbbr(date) === 'SÁB' || getDayAbbr(date) === 'DOM' ? 'saturday-col' : ''}`}>{status || ''}</td>
                                    })}
                                </tr>
                                <tr className="real-row">
                                     {(() => {
                                         const visibleFixedCount = columnWidths.slice(0, dynamicColumns.length + 5).filter(w => w !== 0).length;
                                         const totalVisibleWidth = columnWidths.slice(0, dynamicColumns.length + 5).reduce((a, b) => a + b, 0);
                                         return (
                                             <td 
                                                 colSpan={visibleFixedCount} 
                                                 className="col-sticky col-sticky-1" 
                                                 style={{
                                                     paddingLeft: '50px', 
                                                     width: totalVisibleWidth, 
                                                     left: 0
                                                 }}
                                             >
                                                 <span className="comparison-label-cell" style={{padding: '4px 8px', borderRadius: '4px', marginRight: '8px'}}>Realizado</span>
                                             </td>
                                         );
                                     })()}
                                    {dates.map(date => {
                                        const dateStr = formatDate(date);
                                        const status = liveRow.activity.schedule[dateStr];
                                        return <td key={dateStr} className={`status-cell ${status ? STATUS_CLASS_MAP[status] : ''} ${getDayAbbr(date) === 'SÁB' || getDayAbbr(date) === 'DOM' ? 'saturday-col' : ''}`}>{status || ''}</td>
                                    })}
                                </tr>
                                </React.Fragment>
                             )
                        })}
                    </tbody>
                 </table>
            </div>
        </div>
    )
};