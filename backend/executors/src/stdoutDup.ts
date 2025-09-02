// Cross-platform stdout duplication utility - equivalent to Rust's executors/src/stdout_dup.rs
import { ChildProcess } from 'child_process';
import { Transform } from 'stream';
import { logger } from '../../utils/src/logger';

/**
 * Error class for stdout duplication operations
 */
export class StdoutDupError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'StdoutDupError';
  }
}

/**
 * Duplicates stdout from a child process.
 * 
 * Creates a stream that mirrors stdout of child process without consuming it.
 * Returns a readable stream that receives a copy of all stdout data.
 */
export function duplicateStdout(child: ChildProcess): NodeJS.ReadableStream {
  if (!child.stdout) {
    throw new StdoutDupError('Child process has no stdout', 'NO_STDOUT');
  }

  const { PassThrough } = require('stream');
  
  // Create duplicate stream
  const duplicateStream = new PassThrough();
  
  // Create transform stream to duplicate data
  const duplicator = new Transform({
    transform(chunk, encoding, callback) {
      // Pass through to original stdout
      this.push(chunk);
      
      // Send copy to duplicate stream
      duplicateStream.push(chunk);
      
      callback();
    }
  });

  try {
    // Pipe stdout through the duplicator
    const originalStdout = child.stdout;
    child.stdout = duplicator;
    
    // Pipe original stdout to duplicator
    originalStdout.pipe(duplicator);
    
    // Handle stream errors
    duplicator.on('error', (error) => {
      logger.error('Stdout duplicator error:', error);
      duplicateStream.destroy(error);
    });

    originalStdout.on('error', (error) => {
      logger.error('Original stdout error:', error);
      duplicateStream.destroy(error);
    });

    // Handle end events
    originalStdout.on('end', () => {
      duplicateStream.end();
    });

    duplicator.on('end', () => {
      duplicateStream.end();
    });

    // Clean up on process exit
    child.on('exit', () => {
      duplicateStream.end();
    });

    child.on('error', (error) => {
      duplicateStream.destroy(error);
    });

  } catch (error) {
    const stdoutError = new StdoutDupError(
      `Failed to setup stdout duplication: ${error}`,
      'SETUP_FAILED'
    );
    logger.error('Failed to duplicate stdout:', stdoutError);
    throw stdoutError;
  }

  return duplicateStream;
}

/**
 * Advanced stdout duplication with line-by-line processing
 */
export function duplicateStdoutWithLineProcessor(
  child: ChildProcess,
  lineProcessor?: (line: string) => void
): NodeJS.ReadableStream {
  if (!child.stdout) {
    throw new StdoutDupError('Child process has no stdout', 'NO_STDOUT');
  }

  const { PassThrough, Transform } = require('stream');
  const readline = require('readline');
  
  // Create duplicate stream
  const duplicateStream = new PassThrough();
  let buffer = '';

  // Create transform stream with line processing
  const lineTransform = new Transform({
    transform(chunk, encoding, callback) {
      const data = chunk.toString();
      buffer += data;
      
      // Process complete lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer
      
      for (const line of lines) {
        if (lineProcessor) {
          try {
            lineProcessor(line);
          } catch (error) {
            logger.warn('Line processor error:', error);
          }
        }
        
        // Send to duplicate stream with newline
        duplicateStream.push(line + '\n');
      }
      
      // Pass through original chunk
      this.push(chunk);
      callback();
    },
    
    flush(callback) {
      // Process any remaining buffer content
      if (buffer.length > 0) {
        if (lineProcessor) {
          try {
            lineProcessor(buffer);
          } catch (error) {
            logger.warn('Line processor error on flush:', error);
          }
        }
        duplicateStream.push(buffer);
      }
      duplicateStream.end();
      callback();
    }
  });

  try {
    // Setup the pipeline
    const originalStdout = child.stdout;
    
    originalStdout.pipe(lineTransform);
    
    // Handle errors
    originalStdout.on('error', (error) => {
      logger.error('Original stdout error:', error);
      duplicateStream.destroy(error);
    });

    lineTransform.on('error', (error) => {
      logger.error('Line transform error:', error);
      duplicateStream.destroy(error);
    });

    // Clean up on process events
    child.on('exit', () => {
      lineTransform.end();
    });

    child.on('error', (error) => {
      lineTransform.destroy(error);
    });

  } catch (error) {
    throw new StdoutDupError(
      `Failed to setup stdout duplication with line processor: ${error}`,
      'SETUP_FAILED'
    );
  }

  return duplicateStream;
}

/**
 * Create a tee stream that sends output to multiple destinations
 */
export function createStdoutTee(
  child: ChildProcess,
  destinations: NodeJS.WritableStream[]
): NodeJS.ReadableStream {
  if (!child.stdout) {
    throw new StdoutDupError('Child process has no stdout', 'NO_STDOUT');
  }

  const { PassThrough } = require('stream');
  const outputStream = new PassThrough();

  try {
    child.stdout.on('data', (chunk) => {
      // Send to all destinations
      destinations.forEach(dest => {
        try {
          dest.write(chunk);
        } catch (error) {
          logger.warn('Failed to write to destination:', error);
        }
      });
      
      // Send to output stream
      outputStream.push(chunk);
    });

    child.stdout.on('end', () => {
      outputStream.end();
      // End all destinations
      destinations.forEach(dest => {
        if (typeof dest.end === 'function') {
          dest.end();
        }
      });
    });

    child.stdout.on('error', (error) => {
      outputStream.destroy(error);
    });

    child.on('error', (error) => {
      outputStream.destroy(error);
    });

  } catch (error) {
    throw new StdoutDupError(
      `Failed to create stdout tee: ${error}`,
      'TEE_SETUP_FAILED'
    );
  }

  return outputStream;
}
