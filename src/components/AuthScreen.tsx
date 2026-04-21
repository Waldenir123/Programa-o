import React, { useState } from 'react';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { auth } from '../firebase';

export const AuthScreen = () => {
    const [error, setError] = useState('');

    const handleGoogleLogin = async () => {
        try {
            setError('');
            const provider = new GoogleAuthProvider();
            // Optional: force custom parameters if needed
            await signInWithPopup(auth, provider);
        } catch (err: any) {
            console.error("Firebase Auth Error:", err);
            // If it's a network error, sometimes users need to open the app in a new tab
            if (err.code === 'auth/network-request-failed') {
                setError('Erro de rede: O bloqueador de anúncios ou configurações de privacidade do navegador podem estar bloqueando o login. Tente abrir o aplicativo em uma nova aba ou desativar os bloqueadores.');
            } else {
                setError(err.message || 'Erro ao fazer login com o Google.');
            }
        }
    };

    return (
        <div className="auth-screen">
            <div className="auth-form-container">
                <h1>Plataforma Avançada de Programação</h1>
                <p>Acesse sua conta com o Google para continuar.</p>
                {error && <p className="auth-error" style={{ color: '#ea4335', marginBottom: '10px' }}>{error}</p>}
                
                {window.self !== window.top && error.includes('rede') && (
                    <button onClick={() => window.open(window.location.href, '_blank')} className="submit-button" style={{ marginTop: '10px', backgroundColor: '#fbbf24', color: '#1e293b' }}>
                        Tentar abrir em Nova Aba
                    </button>
                )}

                <button onClick={handleGoogleLogin} className="submit-button" style={{ marginTop: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                    <svg width="18" height="18" viewBox="0 0 18 18">
                        <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
                        <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-2.908.86-2.238 0-4.135-1.512-4.816-3.542H1.359v2.325C2.827 16.144 5.674 18 9 18z"/>
                        <path fill="#FBBC05" d="M4.184 10.876a5.466 5.466 0 01-.282-1.724c0-.604.106-1.192.282-1.724V5.103H1.359A8.996 8.996 0 000 9.152c0 1.452.348 2.839.953 4.049l2.231-2.325z"/>
                        <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.674 0 2.827 1.856 1.359 4.848l2.825 2.192C4.865 5.008 6.762 3.58 9 3.58z"/>
                    </svg>
                    Entrar com o Google
                </button>
                <p className="auth-footer" style={{ marginTop: '20px' }}>Desenvolvido por: Waldenir Oliveira | Versão: V10</p>
            </div>
        </div>
    );
};
