import fs from 'fs';

const logFile = '/tmp/glmclaw.log';
const file = fs.openSync(logFile, 'a');

function write(str: string) {
  fs.writeSync(file, str + '\n');
  process.stdout.write(str + '\n');
  fs.fsyncSync(file);
}

function writeErr(str: string) {
  fs.writeSync(file, '[ERR] ' + str + '\n');
  process.stderr.write('[ERR] ' + str + '\n');
  fs.fsyncSync(file);
}

const formatMsg = (obj: unknown, ...args: unknown[]): string => {
  if (typeof obj === 'string') {
    return args.length > 0
      ? obj +
          ' ' +
          args
            .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
            .join(' ')
      : obj;
  }
  return JSON.stringify(obj);
};

export const logger = {
  info: (obj: unknown, ...args: unknown[]) => {
    write(formatMsg(obj, ...args));
  },
  error: (obj: unknown, ...args: unknown[]) => {
    writeErr(formatMsg(obj, ...args));
  },
  warn: (obj: unknown, ...args: unknown[]) => {
    write('[WARN] ' + formatMsg(obj, ...args));
  },
  debug: (obj: unknown, ...args: unknown[]) => {
    write('[DEBUG] ' + formatMsg(obj, ...args));
  },
  fatal: (obj: unknown, ...args: unknown[]) => {
    writeErr('[FATAL] ' + formatMsg(obj, ...args));
  },
  child: () => logger,
};

process.on('uncaughtException', (err: Error) => {
  writeErr('Uncaught exception: ' + err.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  writeErr('Unhandled rejection: ' + String(reason));
});
