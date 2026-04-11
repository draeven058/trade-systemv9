import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) return (
      <div style={{minHeight:"100vh",background:"#070d1a",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"sans-serif",padding:20}}>
        <div style={{background:"rgba(220,38,38,0.1)",border:"2px solid rgba(220,38,38,0.4)",borderRadius:16,padding:"32px",maxWidth:600,width:"100%",textAlign:"center"}}>
          <div style={{fontSize:40,marginBottom:12}}>💥</div>
          <h2 style={{color:"#f87171",marginBottom:12}}>App Error</h2>
          <pre style={{background:"rgba(0,0,0,0.4)",padding:"16px",borderRadius:8,color:"#fca5a5",fontSize:12,textAlign:"left",overflowX:"auto",whiteSpace:"pre-wrap",wordBreak:"break-word"}}>
            {this.state.error?.message}
          </pre>
          <p style={{color:"#94a3b8",fontSize:13,marginTop:16}}>
            Check that VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in Vercel Environment Variables, then Redeploy.
          </p>
        </div>
      </div>
    );
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
