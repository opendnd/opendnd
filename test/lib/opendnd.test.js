const expect = require('chai').expect;
const path = require('path');
const rootDir = path.join(__dirname, '..', '..');
const libDir = path.join(rootDir, 'lib');
const opendnd = require(path.join(libDir, 'opendnd'));

describe('opendnd', () => {
  it('is an object', () => {
    expect(opendnd).to.be.an('object');
  });
});
