import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

@Schema({
  timestamps: true,
  toJSON: {
    transform: (_doc: any, ret: any) => {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class User {
  @Prop({ required: true, unique: true, index: true })
  userId: string;

  @Prop({ required: true, index: true })
  username: string;

  @Prop({ required: true, index: true })
  room: string;

  @Prop({ required: true, default: true })
  isOnline: boolean;

  @Prop({ required: true, default: false })
  isTyping: boolean;

  @Prop({ required: true, unique: true, sparse: true, index: true })
  socketId: string;

  @Prop({ required: true, default: () => new Date(), index: true })
  lastActive: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Add compound indexes for common query patterns
UserSchema.index({ room: 1, username: 1 });
UserSchema.index({ isOnline: 1, lastActive: -1 });
UserSchema.index({ username: 1, isOnline: 1 });
