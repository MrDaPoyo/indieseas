import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-cpu';
import * as use from '@tensorflow-models/universal-sentence-encoder';

tf.setBackend('cpu');

const model = await use.load();
const sentences = ['This is a test sentence.'];
const embeddings = await model.embed(sentences);

// Get the raw values for pgvector
const embeddingArray = await embeddings.array();  // Shape: [1, 512]
console.log(embeddingArray[0]);  // <-- store this in pgvector