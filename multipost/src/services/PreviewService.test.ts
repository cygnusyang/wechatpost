import { PreviewService } from './PreviewService';
import * as vscode from 'vscode';

describe('PreviewService', () => {
  let mockExtensionUri: vscode.Uri;

  beforeEach(() => {
    mockExtensionUri = vscode.Uri.file('/test/extension');
    jest.clearAllMocks();
  });

  it('should instantiate correctly', () => {
    const service = new PreviewService(mockExtensionUri);
    expect(service).toBeDefined();
    expect(service.getPanel()).toBeUndefined();
  });

  it('should open preview when no panel exists', () => {
    const service = new PreviewService(mockExtensionUri);
    const markdown = '# Test\n\nHello world';

    service.openPreview(markdown);

    expect(vscode.window.createWebviewPanel).toHaveBeenCalled();
    expect(service.getPanel()).toBeDefined();
  });

  it('should reveal existing panel when opening preview again', () => {
    const service = new PreviewService(mockExtensionUri);
    const markdown = '# Test';

    service.openPreview(markdown);
    const panel = service.getPanel();
    const revealSpy = jest.spyOn(panel!, 'reveal');

    service.openPreview(markdown);

    expect(revealSpy).toHaveBeenCalled();
    expect(service.getPanel()).toBe(panel); // Same instance
  });

  it('should clear panel reference when disposed', () => {
    const service = new PreviewService(mockExtensionUri);
    const markdown = '# Test';

    service.openPreview(markdown);
    expect(service.getPanel()).toBeDefined();

    // Get the onDidDispose callback and call it
    const panel = service.getPanel();
    const onDidDisposeSpy = panel!.onDidDispose as jest.Mock;
    const callback = onDidDisposeSpy.mock.calls[0][0];
    callback();

    expect(service.getPanel()).toBeUndefined();
  });

  it('should do nothing when updating content without panel', () => {
    const service = new PreviewService(mockExtensionUri);
    // Should not throw
    expect(() => service.updateContent('# Test')).not.toThrow();
  });

  it('should post update message when updating content with panel', () => {
    const service = new PreviewService(mockExtensionUri);
    const markdown = '# Test\n\nContent';

    service.openPreview(markdown);
    const panel = service.getPanel()!;

    // The postMessage is called from openPreview via updateContent
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: 'updateMarkdown',
      markdown,
    });
  });

  it('should do nothing when updating auth status without panel', () => {
    const service = new PreviewService(mockExtensionUri);
    // Should not throw
    expect(() => service.updateAuthStatus(true)).not.toThrow();
  });

  it('should post auth status when updating auth with panel', () => {
    const service = new PreviewService(mockExtensionUri);
    service.openPreview('# Test');

    service.updateAuthStatus(true, 'Test User');

    const panel = service.getPanel()!;
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: 'wechatAuthStatus',
      loggedIn: true,
      userName: 'Test User',
    });
  });
});
