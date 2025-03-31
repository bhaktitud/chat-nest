import { Injectable, Logger } from '@nestjs/common';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

@Injectable()
export class ConfigService {
  private readonly logger = new Logger(ConfigService.name);
  private readonly envConfig: Record<string, string>;

  constructor() {
    this.logger.log('Config service initialized');
    this.envConfig = process.env as Record<string, string>;

    // Log available environment variables
    this.logger.log(
      `Environment variables loaded: ${Object.keys(this.envConfig)
        .filter((key) => !key.includes('_'))
        .join(', ')}`,
    );
  }

  get(key: string, defaultValue: string = ''): string {
    const value = this.envConfig[key] || defaultValue;

    // Just for debugging
    if (key === 'MONGODB_URI') {
      this.logger.debug(`MONGODB_URI: ${value || 'not set'}`);
    }

    return value;
  }

  get mongodbUri(): string {
    // Try different case variations
    const uriVariations = [
      'MONGODB_URI',
      'mongodb_uri',
      'MongoDB_URI',
      'MONGO_URI',
      'mongo_uri',
    ];

    let uri = '';
    for (const key of uriVariations) {
      uri = this.envConfig[key] || '';
      if (uri) {
        this.logger.log(`Found MongoDB URI using key: ${key}`);
        break;
      }
    }

    this.logger.log(
      `MongoDB URI from env: ${uri ? 'Found (not showing full URI for security)' : 'not found, using default'}`,
    );

    if (uri) {
      // Check for potential URI format issues
      if (uri.includes('+srv') && uri.includes('directConnection')) {
        this.logger.warn(
          'Warning: SRV URI with directConnection parameter detected - this combination is not supported',
        );
      }

      // Don't modify the URI string if it's using SRV format
      if (uri.startsWith('mongodb+srv://')) {
        this.logger.log('Using MongoDB Atlas SRV connection string');
        return uri;
      }

      return uri;
    }

    // Construct URI from parts if not provided as a whole
    const host = this.get('MONGODB_HOST', 'localhost');
    const port = this.get('MONGODB_PORT', '27017');
    const username = this.get('MONGODB_USERNAME', '');
    const password = this.get('MONGODB_PASSWORD', '');
    const auth = username ? `${username}:${password}@` : '';
    const database = this.get('DATABASE_NAME', 'chat_db');

    const constructedUri = `mongodb://${auth}${host}:${port}/${database}`;
    this.logger.log(
      `Using constructed MongoDB URI with host: ${host} and port: ${port}`,
    );

    // Use a direct connection string instead of SRV format
    return constructedUri;
  }

  get databaseName(): string {
    return this.get('DATABASE_NAME', 'chat_db');
  }
}
