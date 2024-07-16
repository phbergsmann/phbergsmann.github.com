---
title: "Sharing PGVector Vector Store Between NodeJS and Python in LangChain"
description: "This blog post addresses the challenge of sharing a PGVector vector store between NodeJS and Python in the LangChain framework. It details the steps to configure PGVectorStore for embeddings, ensuring seamless data sharing and retrieval across both environments."
category: "LangChain"
tags: [langchain,ai]
classes: wide
---

LangChain.js and its Python counterpart are distinct projects with unique DocumentLoaders, which posed a challenge for my current project. In this project my task was to implement a shared vector store accessible by both NodeJS and Python using PGVector. This setup enables us to leverage [Retrieval-Augmented Generation (RAG)](https://www.promptingguide.ai/techniques/rag) in the Python project using data loaded from the JavaScript side.

Additionally, I chose [Ollama](https://ollama.com/) for embeddings because I have a single-node OpenShift setup at home equipped with an NVIDIA RTX 3090. This allows me to run and manage our own embedding services efficiently.

## The Challenge

The core challenge was to ensure seamless data sharing between LangChain.js and LangChain in Python. The key requirements included:
1. Extracting data from a Notion workspace using LangChain.js.
2. Storing this data in a vector store accessible by both NodeJS and Python.
3. Using the stored data for RAG in the Python project.

To achieve this, I needed to configure both LangChain variants consistently and handle UUID assignments manually in the JavaScript part to ensure compatibility with the Python part.

## Solution Overview

To find a workable solution, I had to dig deep into the sources of both PGVector implementations. This deep dive led me to a solution that works with the available configuration options.

The solution involved the following steps:
1. Setting up the environment and dependencies in both NodeJS and Python.
2. Configuring [PGVectorStore](https://github.com/pgvector/pgvector) in NodeJS to store embeddings.
3. Retrieving and using the stored embeddings in Python.

### Environment Setup

#### JavaScript Environment Variables
Ensure the following environment variables are set for the NodeJS part:
{% highlight bash %}
OLLAMA_BASE_URL=""
PGVECTOR_HOST="127.0.0.1"
PGVECTOR_PORT=5432
PGVECTOR_USER="vectordb"
PGVECTOR_PASSWORD="vectordb"
PGVECTOR_DATABASE="vectordb"
PGVECTOR_COLLECTION="mycollection"
EMBEDDING_MODELL="nomic-embed-text"
{% endhighlight %}

#### Python Environment Variables
Ensure the following environment variables are set for the Python part:
{% highlight bash %}
EMBEDDING_MODELL="nomic-embed-text"
OLLAMA_BASE_URL=""
PGVECTOR_CONNECTION_STRING="postgresql+psycopg://vectordb:vectordb@localhost:5432/vectordb"
PGVECTOR_COLLECTION="mycollection"
{% endhighlight %}

### Step-by-Step Implementation

#### Part 1: Configuring NodeJS

1. **Install Dependencies**:
    {% highlight bash %}
    npm install @langchain/community pg uuid
    {% endhighlight %}

2. **JavaScript Code**:
    {% highlight javascript %}
    import { OllamaEmbeddings } from "@langchain/community/embeddings/ollama";
    import { DistanceStrategy, PGVectorStore } from "@langchain/community/vectorstores/pgvector";
    import { PoolConfig } from "pg";
    import { v4 as uuidv4 } from 'uuid';

    const config = {
      postgresConnectionOptions: {
        type: "postgres",
        host: process.env.PGVECTOR_HOST,
        port: process.env.PGVECTOR_PORT,
        user: process.env.PGVECTOR_USER,
        password: process.env.PGVECTOR_PASSWORD,
        database: process.env.PGVECTOR_DATABASE,
      } as PoolConfig,
      collectionName: process.env.PGVECTOR_COLLECTION,
      collectionTableName: "langchain_pg_collection",
      tableName: "langchain_pg_embedding",
      columns: {
        idColumnName: "id",
        vectorColumnName: "embedding",
        contentColumnName: "document",
        metadataColumnName: "cmetadata",
      },
      distanceStrategy: "cosine" as DistanceStrategy,
    };

    async function embedDocuments(documents: any) {
      const pgvectorStore = await PGVectorStore.initialize(
        new OllamaEmbeddings({
          model: process.env.EMBEDDING_MODELL,
          baseUrl: process.env.OLLAMA_BASE_URL,
        }),
        config
      );

      const ids = Array.from({ length: documents.length }, () => uuidv4());

      await pgvectorStore.addDocuments(documents, { ids: ids });
    }

    export { embedDocuments };
    {% endhighlight %}

3. **Explanation**:
    - **Dependencies**: The script imports necessary modules, including `OllamaEmbeddings` for creating embeddings and `PGVectorStore` for storing vectors in PostgreSQL. The `uuid` module is used to generate unique identifiers for documents.
    - **Configuration Object**: Defines PostgreSQL connection options and details about how documents will be stored, including table names and column names.
    - **Embedding Documents**: Initializes a `PGVectorStore` with the specified embeddings model and configuration, generates unique IDs for each document, and adds the documents to the vector store.

#### Part 2: Configuring Python

1. **Install Dependencies**:
    {% highlight bash %}
    pip install langchain-community langchain-postgres
    {% endhighlight %}

2. **Python Code**:
    {% highlight python %}
    from langchain_community.embeddings import OllamaEmbeddings
    from langchain_postgres.vectorstores import PGVector
    import os

    embeddings = OllamaEmbeddings(
        model=os.environ['EMBEDDING_MODELL'], 
        base_url=os.environ.get('OLLAMA_BASE_URL')
    )

    connection = os.environ.get("PGVECTOR_CONNECTION_STRING")
    collection_name = os.environ.get("PGVECTOR_COLLECTION")

    vectorstore = PGVector(
        embeddings=embeddings,
        collection_name=collection_name,
        connection=connection,
        use_jsonb=True,
    )

    retriever = vectorstore.as_retriever()
    {% endhighlight %}

3. **Explanation**:
    - **Dependencies**: Imports necessary modules, including `OllamaEmbeddings` for creating embeddings and `PGVector` for interacting with the vector store in PostgreSQL.
    - **Environment Variables**: Retrieves configuration details such as the connection string for PostgreSQL, the collection name, and the model details.
    - **Embedding and Vector Store**: Initializes the `OllamaEmbeddings` object with the specified model and base URL. Initializes the `PGVector` object with the embeddings, collection name, and connection details. The `use_jsonb=True` parameter ensures that metadata is stored in JSONB format, which is efficient for retrieval operations.
    - **Retriever Setup**: Creates a retriever using the `as_retriever` method on the `vectorstore` object to fetch relevant documents based on embeddings.

### Conclusion

By following these steps, I was able to successfully share a PGVector vector store between NodeJS and Python in LangChain.js. This integration allows leveraging the strengths of both LangChain variants, enabling more flexible and powerful applications. Stay tuned for the full project details, where I will delve deeper into how this integration powers our specific use case.