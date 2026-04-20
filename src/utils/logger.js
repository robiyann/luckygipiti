const chalk = require('chalk');

const icons = {
  info: chalk.blue('🔵'),
  success: chalk.green('✅'),
  warn: chalk.yellow('⚠️'),
  error: chalk.red('🚫'),
  step: chalk.magenta('⚡'),
  debug: chalk.gray('🔍'),
  bullet: chalk.cyan('»'),
  wait: chalk.yellow('⏳')
};

function timestamp() {
  const now = new Date();
  const h = now.getHours().toString().padStart(2, '0');
  const m = now.getMinutes().toString().padStart(2, '0');
  const s = now.getSeconds().toString().padStart(2, '0');
  return chalk.gray(`[${h}:${m}:${s}]`);
}

function stripAnsi(str) {
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

let telegramUpdater = null;

const logger = {
  setTelegramUpdater: (fn) => {
    telegramUpdater = fn;
  },
  info: (msg, ...args) => {
    console.log(`${timestamp()} ${icons.info} ${chalk.cyan(msg)}`, ...args);
    if (telegramUpdater) telegramUpdater(`ℹ️ ${stripAnsi(msg)}`).catch(() => {});
  },
  success: (msg, ...args) => {
    console.log(`${timestamp()} ${icons.success} ${chalk.green.bold(msg)}`, ...args);
    if (telegramUpdater) telegramUpdater(`✅ ${stripAnsi(msg)}`).catch(() => {});
  },
  warn: (msg, ...args) => {
    console.log(`${timestamp()} ${icons.warn} ${chalk.yellow.bold(msg)}`, ...args);
    if (telegramUpdater) telegramUpdater(`⚠️ ${stripAnsi(msg)}`).catch(() => {});
  },
  error: (msg, ...args) => {
    console.log(`${timestamp()} ${icons.error} ${chalk.red.bold(msg)}`, ...args);
    if (telegramUpdater) telegramUpdater(`❌ ${stripAnsi(msg)}`).catch(() => {});
  },
  step: (step, msg, ...args) => {
    console.log(`${timestamp()} ${icons.step} ${chalk.magenta.bold(`[PHASE ${step}]`)} ${chalk.white(msg)}`, ...args);
    if (telegramUpdater) telegramUpdater(`🚀 <b>[${step}]</b> ${stripAnsi(msg)}`).catch(() => {});
  },
  debug: (msg, ...args) => {
    if (process.env.DEBUG) {
      console.log(`${timestamp()} ${icons.debug} ${chalk.gray(msg)}`, ...args);
    }
  },
  divider: () => {
    console.log(chalk.gray('  ' + '━'.repeat(60)));
  },
  account: (email) => {
    console.log('');
    const label = ` SESSION: ${email} `;
    const padding = Math.max(0, 58 - label.length);
    const border = '━'.repeat(label.length);
    
    console.log(chalk.blue.bold('  ┏' + '━'.repeat(58) + '┓'));
    console.log(chalk.blue.bold('  ┃') + chalk.white.bold(label) + ' '.repeat(padding) + chalk.blue.bold('┃'));
    console.log(chalk.blue.bold('  ┗' + '━'.repeat(58) + '┛'));
  }
};

module.exports = logger;



