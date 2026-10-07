import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw, WifiOff, ShieldCheck, MessageCircle } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  isNetworkError: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  private rejectionHandler: ((e: PromiseRejectionEvent) => void) | null = null;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, isNetworkError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    const isNetwork = error.name === 'NetworkError' ||
      error.message.includes('网络') ||
      error.message.includes('network') ||
      error.message.includes('timeout') ||
      error.message.includes('超时');
    return { hasError: true, error, isNetworkError: isNetwork };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info);
  }

  componentDidMount() {
    this.rejectionHandler = (e: PromiseRejectionEvent) => {
      e.preventDefault();
      const reason = e.reason;
      const error = reason instanceof Error ? reason : new Error(String(reason));
      const isNetwork = error.name === 'NetworkError' ||
        error.message.includes('网络') ||
        error.message.includes('network') ||
        error.message.includes('timeout') ||
        error.message.includes('超时');
      this.setState({ hasError: true, error, isNetworkError: isNetwork });
    };
    window.addEventListener('unhandledrejection', this.rejectionHandler);
  }

  componentWillUnmount() {
    if (this.rejectionHandler) {
      window.removeEventListener('unhandledrejection', this.rejectionHandler);
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, isNetworkError: false });
  };

  // Safe reset: clears localStorage session for the current group and reloads,
  // forcing a fresh data load from the server. This recovers from corrupted
  // local state without losing server-side data.
  handleSafeReset = () => {
    try {
      // Remove cached session to force fresh login + data load
      localStorage.removeItem('hotel-sim-session');
      // Remove any other app-specific caches
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('hotel-sim-')) {
          localStorage.removeItem(key);
        }
      }
    } catch {
      // localStorage may be unavailable (private browsing); ignore
    }
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-slate-200 p-8 text-center">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4 bg-amber-100">
              {this.state.isNetworkError ? (
                <WifiOff className="w-7 h-7 text-amber-600" />
              ) : (
                <AlertTriangle className="w-7 h-7 text-amber-600" />
              )}
            </div>
            <h2 className="text-lg font-semibold text-slate-800 mb-2">
              {this.state.isNetworkError ? '网络连接异常' : '页面出了点问题'}
            </h2>
            <p className="text-sm text-slate-500 mb-1">
              {this.state.isNetworkError
                ? '网络不佳，请检查网络连接后重试。'
                : '界面加载时遇到了错误，可能是数据格式不一致或网络问题。'}
            </p>
            {this.state.error?.message && !this.state.isNetworkError && (
              <p className="text-xs text-slate-400 mb-5 font-mono break-all bg-slate-50 rounded-lg p-2">
                {this.state.error.message}
              </p>
            )}
            <div className="flex flex-col gap-2.5 justify-center">
              <div className="flex gap-2.5 justify-center">
                <button
                  onClick={this.handleReset}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-700 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition"
                >
                  <RotateCcw className="w-4 h-4" />
                  重试
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-white text-slate-600 text-sm font-medium rounded-lg border border-slate-300 hover:bg-slate-50 transition"
                >
                  <RotateCcw className="w-4 h-4" />
                  刷新页面
                </button>
              </div>
              <button
                onClick={this.handleSafeReset}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-50 text-amber-700 text-sm font-medium rounded-lg border border-amber-200 hover:bg-amber-100 transition"
              >
                <ShieldCheck className="w-4 h-4" />
                安全重置当前周
              </button>
              <p className="text-xs text-slate-400 mt-1">
                如问题持续，请联系授课教师协助处理
              </p>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
