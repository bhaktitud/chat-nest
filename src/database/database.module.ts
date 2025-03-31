import { Module, Global } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '../config/config.module';
import { ConfigService } from '../config/config.service';
import { MongoMemoryService } from './mongodb-memory.service';
import * as mongoose from 'mongoose';

// Mark as global module to make services available throughout the application
@Global()
@Module({
  imports: [
    ConfigModule,
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const memoryService = new MongoMemoryService();
        await memoryService.onModuleInit();

        let uri = configService.mongodbUri;
        let dbName = configService.databaseName;

        console.log('MongoDB URI format check:', uri.substring(0, 12) + '...');

        // Set connect options based on URI format (SRV or standard)
        const isSrvUri = uri.includes('+srv');
        const connectOptions = {
          serverSelectionTimeoutMS: 2000,
          // Only use directConnection for non-SRV URIs
          ...(isSrvUri ? {} : { directConnection: true }),
        };

        // Initialize in-memory MongoDB as fallback
        try {
          console.log('Trying to connect to MongoDB...');
          // Test if the real MongoDB URI is working
          await mongoose.connect(uri, connectOptions);
          await mongoose.connection.close();
          console.log('Successfully connected to MongoDB');
        } catch (error) {
          console.warn(
            'Failed to connect to MongoDB, using memory server instead',
          );
          console.error(
            'Original error:',
            error instanceof Error ? error.message : String(error),
          );

          // Use memory server URI instead
          uri = memoryService.getUri();
          dbName = 'test';
          console.log('Using in-memory MongoDB at:', uri);
        }

        return {
          uri,
          dbName,
          retryAttempts: 3,
          retryDelay: 1000,
        };
      },
    }),
  ],
  providers: [MongoMemoryService],
  exports: [MongooseModule, MongoMemoryService],
})
export class DatabaseModule {}
