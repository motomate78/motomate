import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-black text-white p-8 flex flex-col items-center justify-center">
          <h1 className="text-3xl font-bold text-red-500 mb-4">Что-то пошло не так</h1>
          <div className="bg-zinc-900 p-4 rounded-lg max-w-2xl w-full overflow-auto border border-zinc-800">
            <h2 className="text-xl font-bold mb-2 text-orange-500">Ошибка</h2>
            <pre className="text-sm text-red-300 mb-4 whitespace-pre-wrap">
              {this.state.error && this.state.error.toString()}
            </pre>
            <h2 className="text-xl font-bold mb-2 text-orange-500">Стек</h2>
            <pre className="text-xs text-zinc-400 whitespace-pre-wrap">
              {this.state.errorInfo && this.state.errorInfo.componentStack}
            </pre>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 px-6 py-3 bg-orange-600 rounded-full font-bold hover:bg-orange-700 transition"
          >
            Перезагрузить приложение
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
