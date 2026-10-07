// Test-only capture. Even a simulated success cannot be acknowledged as physical dispatch.
export class MockTransportError extends Error {
  constructor(code, retryable) {
    super(code);
    this.name = 'MockTransportError';
    this.code = code;
    this.retryable = retryable;
    this.simulated = true;
  }
}

export class MockPrinterTransport {
  constructor(mode = 'success') {
    this.mode = mode;
    this.simulationOnly = true;
    this.captured = [];
  }

  async send(document) {
    this.captured.push(structuredClone(document));
    if (this.mode === 'timeout') throw new MockTransportError('CONNECTION_TIMEOUT', true);
    if (this.mode === 'offline') throw new MockTransportError('PRINTER_OFFLINE', true);
    if (this.mode === 'retryable') throw new MockTransportError('NETWORK_UNREACHABLE', true);
    if (this.mode !== 'success') throw new Error('Unknown mock mode');
    return { simulated: true, physicalAcceptance: false, documentCount: this.captured.length };
  }
}
