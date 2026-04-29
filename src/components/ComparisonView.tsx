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

    const headerNames = useMemo(() => {
        return ['ID', ...(dynamicColumns || []).map(c => c.name), 'TAREFA PRINCIPAL', 'ATIVIDADE', 'PLANO'];
    }, [dynamicColumns]);

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
                            {headerNames.map((header, index) => (
                                <th key={header} rowSpan={3} style={{ width: columnWidths[index], left: stickyColumnPositions[index] }} className={`col-sticky col-sticky-${index + 1}`}>
                                    <div className="header-content"><span>{header}</span></div>
                                    <div className="resize-handle" onMouseDown={(e) => onResizeStart(index, e)}></div>
                                </th>
                            ))}
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
                                    <td className="col-sticky col-sticky-1" style={{ width: columnWidths[0], left: stickyColumnPositions[0] }}>{liveRow.wbsId}</td>
                                    {(dynamicColumns || []).map((col, idx) => (
                                        <td key={col.id} className={`col-sticky col-sticky-${idx + 2}`} style={{ width: columnWidths[idx + 1], left: stickyColumnPositions[idx + 1] }}>
                                            {liveRow.group.customValues?.[col.id] || ''}
                                        </td>
                                    ))}
                                    <td className={`col-sticky col-sticky-${dynamicColumns.length + 2}`} style={{ width: columnWidths[dynamicColumns.length + 1], left: stickyColumnPositions[dynamicColumns.length + 1] }}>{liveRow.task.title}</td>
                                    <td className={`col-sticky col-sticky-${dynamicColumns.length + 3}`} style={{ width: columnWidths[dynamicColumns.length + 2], left: stickyColumnPositions[dynamicColumns.length + 2] }}>{liveRow.activity.name}</td>
                                    <td className={`col-sticky col-sticky-${dynamicColumns.length + 4} comparison-label-cell`} style={{ width: columnWidths[dynamicColumns.length + 3], left: stickyColumnPositions[dynamicColumns.length + 3] }}>Planejado</td>
                                    {dates.map(date => {
                                        const dateStr = formatDate(date);
                                        const status = savedRow?.activity.schedule[dateStr];
                                        return <td key={dateStr} className={`status-cell ${status ? STATUS_CLASS_MAP[status] : ''} ${getDayAbbr(date) === 'SÁB' || getDayAbbr(date) === 'DOM' ? 'saturday-col' : ''}`}>{status || ''}</td>
                                    })}
                                </tr>
                                <tr className="real-row">
                                     <td colSpan={dynamicColumns.length + 4} className="col-sticky col-sticky-1" style={{paddingLeft: '50px', width: columnWidths.slice(0, dynamicColumns.length + 4).reduce((a,b) => a+b, 0), left: 0}}>
                                         <span className="comparison-label-cell" style={{padding: '4px 8px', borderRadius: '4px', marginRight: '8px'}}>Realizado</span>
                                     </td>
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