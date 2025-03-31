import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { MongoMemoryServer } from 'mongodb-memory-server';

@Injectable()
export class MongoMemoryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MongoMemoryService.name);
  private mongod: MongoMemoryServer | null = null;
  private uri: string = '';

  async onModuleInit() {
    try {
      this.logger.log('Initializing MongoDB Memory Server...');
      this.mongod = await MongoMemoryServer.create();
      this.uri = this.mongod.getUri();
      this.logger.log(`MongoDB Memory Server started at ${this.uri}`);
    } catch (error) {
      this.logger.error('Failed to start MongoDB Memory Server', error);
    }
  }

  async onModuleDestroy() {
    try {
      if (this.mongod) {
        await this.mongod.stop();
        this.logger.log('MongoDB Memory Server stopped');
      }
    } catch (error) {
      this.logger.error('Failed to stop MongoDB Memory Server', error);
    }
  }

  getUri(): string {
    return this.uri;
  }

  isRunning(): boolean {
    return !!this.mongod;
  }
}
