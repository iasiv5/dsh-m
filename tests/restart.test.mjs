import { expect } from 'chai';
import sinon from 'sinon';
import * as child_process from 'child_process';
import { restartHelperSource } from '../src/core/restart.ts';
import { platform } from 'os';

describe('restartHelperSource', () => {
  let spawnStub;

  beforeEach(() => {
    spawnStub = sinon.stub(child_process, 'spawn').returns({ unref: () => {} });
  });

  afterEach(() => {
    spawnStub.restore();
  });

  it('should spawn process with windowsHide: true on Windows', () => {
    const isWindows = platform() === 'win32';
    restartHelperSource('node', ['app.js']);
    
    expect(spawnStub.calledOnce).to.be.true;
    const options = spawnStub.firstCall.args[2];
    expect(options.detached).to.be.true;
    expect(options.windowsHide).to.equal(isWindows);
  });
});