import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  /** 区块标识，用于错误提示。 */
  label: string;
  children: ReactNode;
  fallback?: (error: Error) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * 轻量错误边界：数据密集型视图（Compare 等）中单个 section 崩溃时，
 * 只降级该 section，不白屏整个页面。错误同时输出到 console 便于排查。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[error-boundary] ${this.props.label} 渲染失败:`, error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error === null) {
      return this.props.children;
    }
    if (this.props.fallback !== undefined) {
      return this.props.fallback(this.state.error);
    }
    return (
      <div className="ui-error-boundary" role="alert">
        <span className="ui-error-boundary-title">{this.props.label}</span>
        <span className="mono ui-error-boundary-detail">{this.state.error.message}</span>
      </div>
    );
  }
}
