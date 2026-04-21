const fs = require('fs');

let appTsx = fs.readFileSync('src/App.tsx', 'utf-8');

// 1. Add Firebase imports
appTsx = appTsx.replace(
  `import { scheduleReducer } from './state/scheduleReducer';`,
  `import { auth, db } from './firebase';\nimport { onAuthStateChanged, signOut, User } from 'firebase/auth';\nimport { collection, doc, query, where, onSnapshot, setDoc, deleteDoc } from 'firebase/firestore';\n\nimport { scheduleReducer } from './state/scheduleReducer';`
);

// 2. Add Error Handler
const errorHandler = `
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
}
`;
appTsx = appTsx.replace(`export const App = () => {`, errorHandler + `\n\nexport const App = () => {`);

// 3. Replace state
appTsx = appTsx.replace(
  `  const [users, setUsers] = useState<Record<string, string>>(() => JSON.parse(localStorage.getItem('pcp-users') || '{}'));\n  const [projects, setProjects] = useState<Record<string, UserProjects>>(() => JSON.parse(localStorage.getItem('pcp-projects') || '{}'));\n  const [currentUser, setCurrentUser] = useState<string | null>(() => sessionStorage.getItem('pcp-currentUser'));`,
  `  const [projects, setProjects] = useState<Record<string, Project>>({});
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);`
);

// 4. Replace Auth & Project Management hooks
const newAuthManagement = `  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setIsAuthReady(true);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!isAuthReady || !currentUser) {
       setProjects({});
       return;
    }
    const q = query(collection(db, 'projects'), where('ownerId', '==', currentUser.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
        const newProjects: Record<string, Project> = {};
        snapshot.docs.forEach(docSnap => {
           let data = docSnap.data();
           newProjects[docSnap.id] = {
               ...data,
               liveData: data.liveData ? JSON.parse(data.liveData) : [],
               savedPlan: data.savedPlan ? JSON.parse(data.savedPlan) : null,
               manpowerAllocation: data.manpowerAllocation ? JSON.parse(data.manpowerAllocation) : { roles: PREDEFINED_MANPOWER_ROLES, hasSecondShift: false, data: { adm: {}, shift2: {} } },
               dailyManpowerAllocation: data.dailyManpowerAllocation ? JSON.parse(data.dailyManpowerAllocation) : {}
           } as Project;
        });
        setProjects(newProjects);
        
        // Auto-load last active or first project if none loaded
        if (!activeProject && Object.keys(newProjects).length > 0) {
            const lastActiveId = localStorage.getItem(\`pcp-lastActive-\${currentUser.uid}\`);
            const projectToLoad = newProjects[lastActiveId!] || Object.values(newProjects).sort((a,b) => b.lastModified - a.lastModified)[0];
            if (projectToLoad) {
                setActiveProject(projectToLoad);
                dispatch({ type: 'LOAD_DATA', payload: projectToLoad.liveData });
            }
        }
    }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'projects');
    });
    return unsubscribe;
  }, [currentUser, isAuthReady]);

  const handleLogout = async () => {
    await signOut(auth);
    setActiveProject(null);
  };

  const persistProjectToFirebase = async (project: Project) => {
    try {
      const dbProject = {
        ...project,
        liveData: JSON.stringify(project.liveData),
        savedPlan: project.savedPlan ? JSON.stringify(project.savedPlan) : '',
        manpowerAllocation: JSON.stringify(project.manpowerAllocation),
        dailyManpowerAllocation: JSON.stringify(project.dailyManpowerAllocation)
      };
      await setDoc(doc(db, 'projects', project.id), dbProject);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'projects/' + project.id);
    }
  };

  const handleNewProject = async (name: string) => {
    if (!currentUser) return;
    if (!name.trim()) {
        addToast("O nome do projeto não pode ser vazio.", "error");
        return;
    }
    const newProject = createNewProject(name);
    newProject.ownerId = currentUser.uid;
    
    // Optimistic UI update
    setActiveProject(newProject);
    dispatch({ type: 'LOAD_DATA', payload: newProject.liveData });
    localStorage.setItem(\`pcp-lastActive-\${currentUser.uid}\`, newProject.id);
    setisSaveModalOpen(false);
    
    await persistProjectToFirebase(newProject);
    addToast(\`Projeto '\${name}' criado com sucesso!\`, 'success');
  };
  
  const handleSaveProject = useCallback(async () => {
    if (!currentUser || !activeProject) return;
    const projectToSave = { ...activeProject, liveData, lastModified: Date.now() };
    setActiveProject(projectToSave); 
    await persistProjectToFirebase(projectToSave);
    addToast(\`Projeto '\${projectToSave.name}' salvo!\`, 'success');
  }, [currentUser, activeProject, liveData, addToast]);

  const handleLoadProject = (projectId: string) => {
    if (!currentUser) return;
    const projectToLoad = projects[projectId];
    if (projectToLoad) {
        if (projectToLoad.manpowerAllocation && !(projectToLoad.manpowerAllocation.data as any).adm) {
            const oldData = projectToLoad.manpowerAllocation.data as unknown as any;
            projectToLoad.manpowerAllocation.data = {
                adm: oldData,
                shift2: {}
            };
            projectToLoad.manpowerAllocation.hasSecondShift = false;
        }

        if (!projectToLoad.dailyManpowerAllocation) {
            projectToLoad.dailyManpowerAllocation = {};
        }
        setActiveProject(projectToLoad);
        setCurrentStartDate(new Date(projectToLoad.startDate + 'T00:00:00Z'));
        dispatch({ type: 'LOAD_DATA', payload: projectToLoad.liveData });
        localStorage.setItem(\`pcp-lastActive-\${currentUser.uid}\`, projectId);
        setLoadModalOpen(false);
        addToast(\`Projeto '\${projectToLoad.name}' carregado.\`, 'success');
    }
  };
  
  const handleDeleteProject = async (projectId: string) => {
    if (!currentUser || !window.confirm("Tem certeza que deseja excluir este projeto? Esta ação não pode ser desfeita.")) return;
    const deletedProjectName = projects[projectId]?.name || 'Projeto';
    try {
        await deleteDoc(doc(db, 'projects', projectId));
        addToast(\`Projeto '\${deletedProjectName}' excluído.\`, 'success');
        if (activeProject?.id === projectId) {
            const nextProject = Object.values(projects).filter(p => p.id !== projectId).sort((a,b) => b.lastModified - a.lastModified)[0];
            if (nextProject) {
                handleLoadProject(nextProject.id);
            } else {
                 setActiveProject(null);
                 localStorage.removeItem(\`pcp-lastActive-\${currentUser.uid}\`);
            }
        }
    } catch(err) {
        handleFirestoreError(err, OperationType.DELETE, 'projects/' + projectId);
    }
  };
`;

appTsx = appTsx.replace(
  /\/\/ --- AUTH & PROJECT MANAGEMENT ---\s*useEffect\(\(\) => \{[\s\S]*?const handleUndo = useCallback\(/,
  `// --- AUTH & PROJECT MANAGEMENT ---\n${newAuthManagement}\n  const handleUndo = useCallback(`
);

// We need to fix handleSavePlan references
appTsx = appTsx.replace(
  /const handleSavePlan = useCallback\(\(\) => \{[\s\S]*?addToast\("Planejamento base/,
  `const handleSavePlan = useCallback(async () => {
    if (!activeProject || !currentUser) return;
    if (liveData.length === 0) {
        addToast("Não é possível definir um cronograma vazio como base.", "error");
        return;
    }
    if (window.confirm("Deseja salvar o estado atual como o novo 'Planejamento Base'? Esta ação substituirá o plano anterior.")) {
      const projectWithSavedPlan = { ...activeProject, savedPlan: deepClone(liveData), lastModified: Date.now() };
      setActiveProject(projectWithSavedPlan);
      
      await persistProjectToFirebase(projectWithSavedPlan);

      addToast("Planejamento base`
);

// Find 'if (!currentUser)' before 'return <AuthScreen ... />'
appTsx = appTsx.replace(
  /if \(!currentUser\) \{\s*return <AuthScreen [^>]+ \/>;\s*\}/,
  `if (!isAuthReady) {
      return <div style={{display:'flex',justifyContent:'center',alignItems:'center',height:'100vh',fontSize:'1.2rem',color:'#64748b'}}>Carregando...</div>;
  }
  if (!currentUser) {
      return <AuthScreen />;
  }`
);

// Find user info renderer in the return method and fix it:
// \`\${currentUser}\` ... <button onClick={handleLogout}...
appTsx = appTsx.replace(
  /<span>Olá, \{currentUser\}<\/span>/,
  `<span>Olá, {currentUser?.displayName || currentUser?.email}</span>`
);

// We need to fix `<LoadModal schedules={Object.values(projects[currentUser] || {})}`
appTsx = appTsx.replace(
  /projects\[currentUser\] \|\| \{\}/g,
  `projects`
);

fs.writeFileSync('src/App.tsx', appTsx);
console.log('App.tsx refactored for Firebase Auth and Firestore.');
