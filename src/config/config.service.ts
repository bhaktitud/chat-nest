import { Injectable } from '@nestjs/common';

@Injectable()
export class ConfigService {
  private readonly envConfig: { [key: string]: string };

  constructor() {
    this.envConfig = {
      // Replace YOUR_PASSWORD with your actual MongoDB password
      // If you don't have a password, use this format: mongodb+srv://myforework@cluster0.ce1aj.mongodb.net/
      MONGODB_URI:
        'mongodb+srv://myforework:root@cluster0.ce1aj.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0',
      DATABASE_NAME: 'chat_db',
    };
  }

  get mongodbUri(): string {
    return this.envConfig.MONGODB_URI;
  }

  get databaseName(): string {
    return this.envConfig.DATABASE_NAME;
  }
}
