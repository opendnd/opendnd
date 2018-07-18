const program = require('commander');
const path = require('path');
const rootDir = path.join(__dirname, '..');
const pinfo = require(path.join(rootDir, 'package.json'));

// program basics
program
  .version(pinfo.version, '-v, --version')
  .description(pinfo.description)
  .command('avatar', 'generate an avatar')
  .command('name', 'generate a name')
  .command('dynasty', 'generate a dynasty')
  .command('domain', 'generate a domain')
  .command('person', 'generate a person')
  .command('dna', 'generate DNA')
  .parse(process.argv);

// output help if nothing passed
if (program.args.length === 0) program.outputHelp();
