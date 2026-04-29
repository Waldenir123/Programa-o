import React, { useMemo, useState, useEffect } from 'react';
import { ScheduleData, Status, STATUS_LABELS, STATUS_COLOR_MAP } from '../state/types';
import { formatDate } from '../utils/dataUtils';

interface DailySummaryViewProps {
    data: ScheduleData;
    dates: Date[];
    onTextUpdate: (id: string, field: string, value: string) => void;
    onAddItem: (type: 'group' | 'task' | 'activity', parentId?: string) => void;
    onDeleteItem: (id: string, type: 'group' | 'task' | 'activity') => void;
    onSyncWithSchedule: () => void;
}

export const DailySummaryView: React.FC<DailySummaryViewProps> = ({ data, dates, onTextUpdate, onAddItem, onDeleteItem, onSyncWithSchedule }) => {
    const [viewMode, setViewMode] = useState<'daily' | 'weekly'>('daily');
    const todayStr = formatDate(new Date());
    const initialDate = dates.find(d => formatDate(d) === todayStr) ? todayStr : (dates.length > 0 ? formatDate(dates[0]) : todayStr);
    const [selectedDateStr, setSelectedDateStr] = useState<string>(initialDate);
    
    // Weekly state
    const [selectedWeekStart, setSelectedWeekStart] = useState<string>('');
    const [searchQuery, setSearchQuery] = useState('');

    const weeksOptions = useMemo(() => {
        const options: { value: string, label: string, datesStr: string[] }[] = [];
        if (dates.length === 0) return options;
        
        for (let i = 0; i < dates.length; i += 7) {
            const weekDates = dates.slice(i, i + 7);
            const start = weekDates[0];
            const end = weekDates[weekDates.length - 1];
            const value = formatDate(start);
            const formatStr = (d: Date) => `${d.getUTCDate().toString().padStart(2, '0')}/${(d.getUTCMonth() + 1).toString().padStart(2, '0')}`;
            options.push({ 
                value, 
                label: `${formatStr(start)} até ${formatStr(end)}`,
                datesStr: weekDates.map(formatDate)
            });
        }
        return options;
    }, [dates]);

    useEffect(() => {
        if (weeksOptions.length > 0 && !selectedWeekStart) {
            setSelectedWeekStart(weeksOptions[0].value);
        }
    }, [weeksOptions, selectedWeekStart]);

    const categorizeActivity = (name: string): string => {
        const lowerName = name.toLowerCase();
        if (/(inspeção|inspecao|vt\b|lp\b|dt\b|ut\b|rx\b|ensaio|ultrassom|radiografia|líquido penetrante|partícula magnética)/.test(lowerName)) {
            return "Inspeções (VT, LP, DT, UT, e RX e ensaios)";
        }
        if (/(solda|soldagem|tt\b|tratamento térmico|alívio de tensão|alivio)/.test(lowerName)) {
            return "Soldagem e Tratamento Térmico";
        }
        if (/(usinagem|ferramentaria|corpo de prova|fresagem|fresa|torno\b|mandrilhamento)/.test(lowerName)) {
            return "Usinagem/Ferramentaria";
        }
        if (/(montagem|caldeiraria|acoplamento|ponteamento|ajuste)/.test(lowerName)) {
            return "Montagem e Caldeiraria";
        }
        if (/(corte|traçagem|tracagem|plasma|oxicorte|bisel|chanfro)/.test(lowerName)) {
            return "Setor de Traçagem e Corte";
        }
        return "Outras Atividades";
    };

    const dailySummary = useMemo(() => {
        const categories: Record<string, { groupId: string; groupTitle: string; taskId: string; taskTitle: string; taskFa: string; activities: { id: string; name: string; status: Status }[] }[]> = {
            "Setor de Traçagem e Corte": [],
            "Inspeções (VT, LP, DT, UT, e RX e ensaios)": [],
            "Soldagem e Tratamento Térmico": [],
            "Montagem e Caldeiraria": [],
            "Usinagem/Ferramentaria": [],
            "Outras Atividades": []
        };

        (data || []).forEach(group => {
            const groupTitle = group.customValues?.['grupo'] || 'Grupo Sem Nome'; 
            (group.tarefas || []).forEach(task => {
                (task.activities || []).forEach(a => {
                    const status = a.schedule[selectedDateStr];
                    if (status !== null && status !== undefined) {
                        const catKey = a.sector || categorizeActivity(a.name);
                        if (!categories[catKey]) {
                            categories[catKey] = [];
                        }
                        
                        let taskEntry = categories[catKey].find(t => t.taskId === task.id);
                        if (!taskEntry) {
                            taskEntry = {
                                groupId: group.id,
                                groupTitle,
                                taskId: task.id,
                                taskTitle: task.title,
                                taskFa: task.fa || '',
                                activities: []
                            };
                            categories[catKey].push(taskEntry);
                        }
                        
                        taskEntry.activities.push({
                            id: a.id,
                            name: a.name,
                            status: status as Status
                        });
                    }
                });
            });
        });

        return Object.entries(categories)
            .filter(([_, tasks]) => tasks.length > 0)
            .map(([category, tasks]) => ({ category, tasks }));
    }, [data, selectedDateStr]);

    const handleDragStart = (e: React.DragEvent, activityId: string) => {
        e.dataTransfer.setData('application/x-activity-id', activityId);
    };

    const handleDrop = (e: React.DragEvent, category: string) => {
        e.preventDefault();
        const activityId = e.dataTransfer.getData('application/x-activity-id');
        if (activityId) {
            onTextUpdate(activityId, 'sector', category);
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
    };

    const weeklySummaryByDay = useMemo(() => {
        const selectedWeek = weeksOptions.find(w => w.value === selectedWeekStart);
        if (!selectedWeek) return [];
        const weekDates = selectedWeek.datesStr;
        const result: { dateStr: string; dateObj: Date; categories: any[] }[] = [];
        
        const term = searchQuery.trim().toLowerCase();

        weekDates.forEach(dateStr => {
            const categories: Record<string, any[]> = {
                "Setor de Traçagem e Corte": [],
                "Inspeções (VT, LP, DT, UT, e RX e ensaios)": [],
                "Soldagem e Tratamento Térmico": [],
                "Montagem e Caldeiraria": [],
                "Usinagem/Ferramentaria": [],
                "Outras Atividades": []
            };

            (data || []).forEach(group => {
                const groupTitle = group.customValues?.['grupo'] || 'Grupo Sem Nome'; 
                (group.tarefas || []).forEach(task => {
                    (task.activities || []).forEach(a => {
                        const status = a.schedule[dateStr];
                        if (status !== null && status !== undefined) {
                            if (term && !a.name.toLowerCase().includes(term) && !groupTitle.toLowerCase().includes(term) && !task.title.toLowerCase().includes(term)) {
                                return;
                            }
                            const catKey = a.sector || categorizeActivity(a.name);
                            if (!categories[catKey]) {
                                categories[catKey] = [];
                            }
                            
                            let taskEntry = categories[catKey].find((t: any) => t.taskId === task.id);
                            if (!taskEntry) {
                                taskEntry = {
                                    groupId: group.id,
                                    groupTitle,
                                    taskId: task.id,
                                    taskTitle: task.title,
                                    taskFa: task.fa || '',
                                    activities: []
                                };
                                categories[catKey].push(taskEntry);
                            }
                            
                            taskEntry.activities.push({
                                id: a.id,
                                name: a.name,
                                status: status as Status
                            });
                        }
                    });
                });
            });

            const dayCategories = Object.entries(categories)
                .filter(([_, tasks]) => tasks.length > 0)
                .map(([category, tasks]) => ({ category, tasks }));

            if (dayCategories.length > 0 || !searchQuery) {
                result.push({
                    dateStr,
                    dateObj: new Date(dateStr + 'T00:00:00Z'),
                    categories: dayCategories
                });
            }
        });

        return result;
    }, [data, selectedWeekStart, searchQuery, weeksOptions]);

    const handlePrint = () => {
        window.print();
    };

    return (
        <div className="daily-summary-view" style={{ padding: '24px', backgroundColor: '#f8fafc', height: '100%', overflowY: 'auto' }}>
            <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#1e293b', margin: 0 }}>Gestão de Atividades</h2>
                    <div style={{ display: 'flex', backgroundColor: '#e2e8f0', borderRadius: '8px', padding: '4px' }}>
                        <button 
                            onClick={() => setViewMode('daily')}
                            style={{ 
                                padding: '6px 16px', 
                                borderRadius: '6px', 
                                border: 'none', 
                                cursor: 'pointer',
                                backgroundColor: viewMode === 'daily' ? 'white' : 'transparent',
                                boxShadow: viewMode === 'daily' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                                fontWeight: viewMode === 'daily' ? 'bold' : 'normal',
                                color: viewMode === 'daily' ? '#0f172a' : '#64748b'
                            }}
                        >
                            Resumo Diário
                        </button>
                        <button 
                            onClick={() => setViewMode('weekly')}
                            style={{ 
                                padding: '6px 16px', 
                                borderRadius: '6px', 
                                border: 'none', 
                                cursor: 'pointer',
                                backgroundColor: viewMode === 'weekly' ? 'white' : 'transparent',
                                boxShadow: viewMode === 'weekly' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                                fontWeight: viewMode === 'weekly' ? 'bold' : 'normal',
                                color: viewMode === 'weekly' ? '#0f172a' : '#64748b'
                            }}
                        >
                            Filtro Semanal
                        </button>
                    </div>
                </div>
                
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button 
                        onClick={() => {
                            if (window.confirm("Isso irá substituir o resumo diário atual com os dados da programação. Deseja continuar?")) {
                                onSyncWithSchedule();
                            }
                        }}
                        style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '8px 16px', backgroundColor: '#10b981', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                        className="no-print"
                        title="Atualizar com a programação"
                    >
                        <span className="material-icons" style={{ fontSize: '18px' }}>sync</span> Atualizar com Programação
                    </button>
                    <button 
                        onClick={() => onAddItem('group')}
                        style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '8px 16px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                        className="no-print"
                    >
                        <span className="material-icons" style={{ fontSize: '18px' }}>add</span> Adicionar Grupo
                    </button>
                    {viewMode === 'daily' ? (
                        <div>
                            <label style={{ marginRight: '8px', fontWeight: 'bold', color: '#475569' }}>Data:</label>
                            <select 
                                value={selectedDateStr} 
                                onChange={(e) => setSelectedDateStr(e.target.value)}
                                style={{ padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', outline: 'none' }}
                            >
                                {dates.map(d => (
                                    <option key={formatDate(d)} value={formatDate(d)}>
                                        {d.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}
                                    </option>
                                ))}
                            </select>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                            <div>
                                <label style={{ marginRight: '8px', fontWeight: 'bold', color: '#475569' }}>Semana:</label>
                                <select 
                                    value={selectedWeekStart} 
                                    onChange={(e) => setSelectedWeekStart(e.target.value)}
                                    style={{ padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', outline: 'none' }}
                                >
                                    {weeksOptions.map(w => (
                                        <option key={w.value} value={w.value}>{w.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div style={{ position: 'relative' }}>
                                <span className="material-icons" style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: '18px' }}>search</span>
                                <input 
                                    type="text" 
                                    placeholder="Buscar atividade..." 
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    style={{ padding: '8px 8px 8px 32px', borderRadius: '4px', border: '1px solid #cbd5e1', outline: 'none', width: '200px' }}
                                />
                            </div>
                        </div>
                    )}
                    <button onClick={handlePrint} className="control-button" style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '8px 16px', backgroundColor: '#fbbf24', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
                        <span className="material-icons" style={{ fontSize: '18px' }}>print</span> Imprimir
                    </button>
                </div>
            </div>

            {viewMode === 'daily' ? (
                <>
                    {dailySummary.length === 0 ? (
                        <div className="no-print" style={{ padding: '40px', textAlign: 'center', backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                            <span className="material-icons" style={{ fontSize: '48px', color: '#cbd5e1', marginBottom: '16px' }}>event_busy</span>
                            <p style={{ color: '#64748b', fontSize: '1.1rem' }}>Não há atividades programadas para este dia.</p>
                        </div>
                    ) : (
                        <div className="print-area" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                            <div className="print-only" style={{ display: 'none', marginBottom: '16px' }}>
                                 <h1 style={{ fontSize: '1.5rem', textAlign: 'center', marginBottom: '8px' }}>Resumo Diário - {new Date(selectedDateStr).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</h1>
                            </div>
                            {dailySummary.map(({ category, tasks }) => (
                                <div 
                                    key={category} 
                                    style={{ pageBreakInside: 'avoid', padding: '8px', borderRadius: '8px', transition: 'background-color 0.2s' }}
                                    onDragOver={handleDragOver}
                                    onDrop={(e) => handleDrop(e, category)}
                                >
                                    <h3 style={{ fontSize: '1.25rem', color: '#334155', borderBottom: '2px solid #e2e8f0', paddingBottom: '8px', marginBottom: '16px' }}>{category}</h3>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '16px' }}>
                                        {tasks.map((item, idx) => (
                                            <div key={`${item.taskId}-${idx}`} style={{ backgroundColor: 'white', borderRadius: '8px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', position: 'relative' }}>
                                                <button 
                                                    onClick={() => onDeleteItem(item.taskId, 'task')}
                                                    className="no-print"
                                                    style={{ position: 'absolute', top: '8px', right: '8px', background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }}
                                                    title="Excluir Tarefa"
                                                >
                                                    <span className="material-icons" style={{ fontSize: '20px' }}>delete</span>
                                                </button>
                                                <div style={{ marginBottom: '12px', paddingBottom: '8px', borderBottom: '1px solid #f1f5f9' }}>
                                                    <div 
                                                        contentEditable
                                                        suppressContentEditableWarning
                                                        onBlur={e => onTextUpdate(item.groupId, 'grupo', e.currentTarget.textContent || '')}
                                                        style={{ fontSize: '0.85rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', outline: 'none' }}
                                                    >
                                                        {item.groupTitle}
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                                                        <div 
                                                            contentEditable
                                                            suppressContentEditableWarning
                                                            onBlur={e => onTextUpdate(item.taskId, 'tarefa', e.currentTarget.textContent || '')}
                                                            style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#0f172a', outline: 'none' }}
                                                        >
                                                            {item.taskTitle}
                                                        </div>
                                                        <div 
                                                            contentEditable
                                                            suppressContentEditableWarning
                                                            onBlur={e => onTextUpdate(item.taskId, 'tarefa_fa', e.currentTarget.textContent || '')}
                                                            style={{ fontSize: '0.9rem', color: '#94a3b8', fontStyle: 'italic', outline: 'none' }}
                                                        >
                                                            {item.taskFa ? `${item.taskFa}` : '(FA)'}
                                                        </div>
                                                    </div>
                                                </div>
                                                <ul style={{ listStyleType: 'none', padding: 0, margin: 0 }}>
                                                    {item.activities.map((act, actIdx) => (
                                                        <li 
                                                            key={act.id} 
                                                            draggable
                                                            onDragStart={(e) => handleDragStart(e, act.id)}
                                                            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: actIdx < item.activities.length - 1 ? '1px dashed #e2e8f0' : 'none', cursor: 'grab' }}
                                                        >
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexGrow: 1 }}>
                                                                <span className="material-icons" style={{ color: '#94a3b8', fontSize: '18px', cursor: 'grab' }}>drag_indicator</span>
                                                                <div 
                                                                    contentEditable
                                                                    suppressContentEditableWarning
                                                                    onBlur={e => onTextUpdate(act.id, 'atividade', e.currentTarget.textContent || '')}
                                                                    style={{ color: '#334155', flexGrow: 1, outline: 'none' }}
                                                                >
                                                                    {act.name}
                                                                </div>
                                                            </div>
                                                            <span style={{ 
                                                                padding: '4px 8px', 
                                                                borderRadius: '12px', 
                                                                fontSize: '0.75rem', 
                                                                fontWeight: 'bold',
                                                                backgroundColor: STATUS_COLOR_MAP[act.status],
                                                                color: '#1e293b',
                                                                whiteSpace: 'nowrap',
                                                                marginLeft: '16px'
                                                            }}>
                                                                {STATUS_LABELS[act.status]}
                                                            </span>
                                                        </li>
                                                    ))}
                                                </ul>
                                                <button
                                                    onClick={() => onAddItem('activity', item.taskId)}
                                                    className="no-print"
                                                    style={{ width: '100%', marginTop: '12px', padding: '6px', background: 'transparent', border: '1px dashed #cbd5e1', borderRadius: '4px', cursor: 'pointer', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                >
                                                    <span className="material-icons" style={{ fontSize: '16px', marginRight: '4px' }}>add</span>
                                                    Nova Atividade
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            ) : (
                <>
                    {weeklySummaryByDay.every(day => day.categories.length === 0) ? (
                        <div className="no-print" style={{ padding: '40px', textAlign: 'center', backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                            <span className="material-icons" style={{ fontSize: '48px', color: '#cbd5e1', marginBottom: '16px' }}>search_off</span>
                            <p style={{ color: '#64748b', fontSize: '1.1rem' }}>
                                {searchQuery.trim() ? 'Nenhuma atividade encontrada com esse filtro na semana.' : 'Nenhuma atividade agendada nesta semana.'}
                            </p>
                        </div>
                    ) : (
                        <div className="print-area" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                            <div className="print-only" style={{ display: 'none', marginBottom: '16px' }}>
                                 <h1 style={{ fontSize: '1.5rem', textAlign: 'center', marginBottom: '8px' }}>
                                     Resumo Semanal
                                     {searchQuery.trim() ? ` - Filtro: "${searchQuery}"` : ''}
                                 </h1>
                                 <p style={{ textAlign: 'center', color: '#64748b' }}>
                                     {weeksOptions.find(w => w.value === selectedWeekStart)?.label}
                                 </p>
                            </div>
                            {weeklySummaryByDay.map((daySummary, dayIdx) => daySummary.categories.length > 0 && (
                                <div key={daySummary.dateStr} style={{ backgroundColor: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 4px rgba(0,0,0,0.1)', pageBreakInside: 'avoid' }}>
                                    <h2 style={{ fontSize: '1.5rem', borderBottom: '2px solid #3b82f6', paddingBottom: '8px', marginBottom: '16px', color: '#1e293b' }}>
                                        {daySummary.dateObj.toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'UTC', day: '2-digit', month: '2-digit' }).replace(/^\w/, c => c.toUpperCase())}
                                    </h2>
                                    
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                                        {daySummary.categories.map(({ category, tasks }) => (
                                            <div key={category}>
                                                <h3 style={{ fontSize: '1.1rem', color: '#475569', marginBottom: '12px', fontWeight: 'bold' }}>{category}</h3>
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '16px' }}>
                                                    {tasks.map((item: any, idx: number) => (
                                                        <div key={`${item.taskId}-${idx}`} style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px', position: 'relative' }}>
                                                            <button 
                                                                onClick={() => onDeleteItem(item.taskId, 'task')}
                                                                className="no-print"
                                                                style={{ position: 'absolute', top: '8px', right: '8px', background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }}
                                                                title="Excluir Tarefa"
                                                            >
                                                                <span className="material-icons" style={{ fontSize: '20px' }}>delete</span>
                                                            </button>
                                                            <div style={{ marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px solid #e2e8f0' }}>
                                                                <div 
                                                                    contentEditable
                                                                    suppressContentEditableWarning
                                                                    onBlur={e => onTextUpdate(item.groupId, 'grupo', e.currentTarget.textContent || '')}
                                                                    style={{ fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase', outline: 'none' }}
                                                                >
                                                                    {item.groupTitle}
                                                                </div>
                                                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                                                                    <div 
                                                                        contentEditable
                                                                        suppressContentEditableWarning
                                                                        onBlur={e => onTextUpdate(item.taskId, 'tarefa', e.currentTarget.textContent || '')}
                                                                        style={{ fontSize: '1rem', fontWeight: 'bold', color: '#0f172a', outline: 'none' }}
                                                                    >
                                                                        {item.taskTitle}
                                                                    </div>
                                                                    <div 
                                                                        contentEditable
                                                                        suppressContentEditableWarning
                                                                        onBlur={e => onTextUpdate(item.taskId, 'tarefa_fa', e.currentTarget.textContent || '')}
                                                                        style={{ fontSize: '0.85rem', color: '#94a3b8', fontStyle: 'italic', outline: 'none' }}
                                                                    >
                                                                        {item.taskFa ? `${item.taskFa}` : '(FA)'}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <ul style={{ listStyleType: 'none', padding: 0, margin: 0 }}>
                                                                {item.activities.map((act: any, actIdx: number) => (
                                                                    <li key={act.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: actIdx < item.activities.length - 1 ? '1px dashed #cbd5e1' : 'none' }}>
                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexGrow: 1 }}>
                                                                            <span className="material-icons" style={{ color: '#94a3b8', fontSize: '16px' }}>chevron_right</span>
                                                                            <div 
                                                                                contentEditable
                                                                                suppressContentEditableWarning
                                                                                onBlur={e => onTextUpdate(act.id, 'atividade', e.currentTarget.textContent || '')}
                                                                                style={{ color: '#334155', flexGrow: 1, outline: 'none', fontSize: '0.95rem' }}
                                                                            >
                                                                                {act.name}
                                                                            </div>
                                                                        </div>
                                                                        <span style={{ 
                                                                            padding: '2px 6px', 
                                                                            borderRadius: '8px', 
                                                                            fontSize: '0.7rem', 
                                                                            fontWeight: 'bold',
                                                                            backgroundColor: STATUS_COLOR_MAP[act.status],
                                                                            color: '#1e293b',
                                                                            whiteSpace: 'nowrap',
                                                                            marginLeft: '12px'
                                                                        }}>
                                                                            {STATUS_LABELS[act.status]}
                                                                        </span>
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                            <button
                                                                onClick={() => onAddItem('activity', item.taskId)}
                                                                className="no-print"
                                                                style={{ width: '100%', marginTop: '12px', padding: '6px', background: 'transparent', border: '1px dashed #cbd5e1', borderRadius: '4px', cursor: 'pointer', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                            >
                                                                <span className="material-icons" style={{ fontSize: '16px', marginRight: '4px' }}>add</span>
                                                                Nova Atividade
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

