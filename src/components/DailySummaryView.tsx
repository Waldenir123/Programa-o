import React, { useMemo, useState } from 'react';
import { ScheduleData, Status, STATUS_LABELS, STATUS_COLOR_MAP } from '../state/types';
import { formatDate } from '../utils/dataUtils';

interface DailySummaryViewProps {
    data: ScheduleData;
    dates: Date[];
}

export const DailySummaryView: React.FC<DailySummaryViewProps> = ({ data, dates }) => {
    const todayStr = formatDate(new Date());
    const initialDate = dates.find(d => formatDate(d) === todayStr) ? todayStr : (dates.length > 0 ? formatDate(dates[0]) : todayStr);
    const [selectedDateStr, setSelectedDateStr] = useState<string>(initialDate);

    const summary = useMemo(() => {
        const result: { groupTitle: string; taskTitle: string; taskFa: string; activities: { name: string; status: Status }[] }[] = [];
        data.forEach(group => {
            group.tarefas.forEach(task => {
                const activitiesForDay = task.activities.filter(a => {
                    const status = a.schedule[selectedDateStr];
                    return status !== null && status !== undefined;
                }).map(a => ({
                    name: a.name,
                    status: a.schedule[selectedDateStr]
                }));

                if (activitiesForDay.length > 0) {
                    // Try to finding a group title from custom values, else fallback to standard
                    const groupTitle = group.customValues?.['grupo'] || 'Grupo Sem Nome'; 
                    result.push({
                        groupTitle,
                        taskTitle: task.title,
                        taskFa: task.fa || '',
                        activities: activitiesForDay
                    });
                }
            });
        });
        return result;
    }, [data, selectedDateStr]);

    return (
        <div style={{ padding: '24px', backgroundColor: '#f8fafc', height: '100%', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#1e293b' }}>Resumo Diário</h2>
                <div>
                    <label style={{ marginRight: '8px', fontWeight: 'bold', color: '#475569' }}>Data do Resumo:</label>
                    <select 
                        value={selectedDateStr} 
                        onChange={(e) => setSelectedDateStr(e.target.value)}
                        style={{ padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                    >
                        {dates.map(d => (
                            <option key={formatDate(d)} value={formatDate(d)}>
                                {d.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {summary.length === 0 ? (
                <div style={{ padding: '40px', textAlign: 'center', backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                    <span className="material-icons" style={{ fontSize: '48px', color: '#cbd5e1', marginBottom: '16px' }}>event_busy</span>
                    <p style={{ color: '#64748b', fontSize: '1.1rem' }}>Não há atividades programadas para este dia.</p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {summary.map((item, idx) => (
                        <div key={idx} style={{ backgroundColor: 'white', borderRadius: '8px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                            <div style={{ marginBottom: '12px', paddingBottom: '8px', borderBottom: '1px solid #f1f5f9' }}>
                                <div style={{ fontSize: '0.85rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{item.groupTitle}</div>
                                <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#0f172a' }}>{item.taskTitle} <span style={{ fontSize: '0.9rem', color: '#94a3b8', fontWeight: 'normal' }}>{item.taskFa ? `(${item.taskFa})` : ''}</span></div>
                            </div>
                            <ul style={{ listStyleType: 'none', padding: 0, margin: 0 }}>
                                {item.activities.map((act, actIdx) => (
                                    <li key={actIdx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: actIdx < item.activities.length - 1 ? '1px dashed #e2e8f0' : 'none' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span className="material-icons" style={{ color: '#94a3b8', fontSize: '18px' }}>check_circle_outline</span>
                                            <span style={{ color: '#334155' }}>{act.name}</span>
                                        </div>
                                        <span style={{ 
                                            padding: '4px 8px', 
                                            borderRadius: '12px', 
                                            fontSize: '0.75rem', 
                                            fontWeight: 'bold',
                                            backgroundColor: STATUS_COLOR_MAP[act.status],
                                            color: '#1e293b'
                                        }}>
                                            {STATUS_LABELS[act.status]}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
