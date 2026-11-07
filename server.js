const express = require('express');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const path = require('path');

const app = express();
app.use(express.json());

// Server port
const PORT = process.env.PORT || 3000;

// Database path
const dbPath = path.join(__dirname, 'books.db');

let db = null;

// Initialize database and start server
const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });

    const server = app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(
          `Port ${PORT} is already in use. Please stop any process running on this port.`,
        );
      } else {
        console.error(`Server error: ${error.message}`);
      }

      process.exit(1);
    });
  } catch (error) {
    console.error(`DB Error: ${error.message}`);
    process.exit(1);
  }
};

initializeDBAndServer();

// GET / - Root welcome route
app.get('/', (request, response) => {
  response.status(200).send('Books API Server is running. Visit /books to view all books.');
});

// GET /books/ - Get books with filtering, searching and sorting
app.get('/books/', async (request, response) => {
  try {
    const {
      offset = 0,
      limit = 10,
      order = 'ASC',
      order_by = 'id',
      search_q = '',
      min_price,
      max_price,
    } = request.query

    const limitValue = Number(limit)
    const offsetValue = Number(offset)

    if (
      !Number.isInteger(limitValue) ||
      !Number.isInteger(offsetValue) ||
      limitValue <= 0 ||
      offsetValue < 0
    ) {
      return response.status(400).json({
        error: 'Invalid limit or offset',
      })
    }

    const sortOrder = order.toUpperCase()

    if (!['ASC', 'DESC'].includes(sortOrder)) {
      return response.status(400).json({
        error: 'Order must be ASC or DESC',
      })
    }

    const allowedColumns = ['id', 'title', 'author', 'price', 'pages']

    if (!allowedColumns.includes(order_by)) {
      return response.status(400).json({
        error: 'Invalid order_by column',
      })
    }

    const conditions = ['title LIKE ?']
    const queryParams = [`%${search_q}%`]

    if (min_price !== undefined) {
      const minPriceValue = Number(min_price)

      if (!Number.isFinite(minPriceValue) || minPriceValue < 0) {
        return response.status(400).json({
          error: 'min_price must be a valid non-negative number',
        })
      }

      conditions.push('price >= ?')
      queryParams.push(minPriceValue)
    }

    if (max_price !== undefined) {
      const maxPriceValue = Number(max_price)

      if (!Number.isFinite(maxPriceValue) || maxPriceValue < 0) {
        return response.status(400).json({
          error: 'max_price must be a valid non-negative number',
        })
      }

      conditions.push('price <= ?')
      queryParams.push(maxPriceValue)
    }

    if (
      min_price !== undefined &&
      max_price !== undefined &&
      Number(min_price) > Number(max_price)
    ) {
      return response.status(400).json({
        error: 'min_price cannot be greater than max_price',
      })
    }

    const getBooksQuery = `
      SELECT *
      FROM book
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${order_by} ${sortOrder}
      LIMIT ? OFFSET ?;
    `

    queryParams.push(limitValue, offsetValue)

    const booksArray = await db.all(getBooksQuery, queryParams)

    response.status(200).json(booksArray)
  } catch (error) {
    console.error(`Error fetching books: ${error.message}`)
    response.status(500).json({
      error: 'Internal Server Error',
    })
  }
})

// GET /books/:bookId/ - Get a book by ID
app.get('/books/:bookId/', async (request, response) => {
  try {
    const { bookId } = request.params

    const getBookQuery = `
      SELECT *
      FROM book
      WHERE id = ?;
    `

    const book = await db.get(getBookQuery, [bookId])

    if (book === undefined) {
      return response.status(404).json({
        error: 'Book not found',
      })
    }

    response.status(200).json(book)
  } catch (error) {
    console.error(`Error fetching book: ${error.message}`)
    response.status(500).json({
      error: 'Internal Server Error',
    })
  }
})

// POST /books/ - Add a new book
app.post('/books/', async (request, response) => {
  try {
    const { title, author, price, pages } = request.body

    if (!title || !author || price === undefined || price === null) {
      return response.status(400).json({
        error: 'Title, author, and price are required',
      })
    }

    if (
      typeof title !== 'string' ||
      typeof author !== 'string' ||
      title.trim() === '' ||
      author.trim() === ''
    ) {
      return response.status(400).json({
        error: 'Title and author must be non-empty strings',
      })
    }

    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
      return response.status(400).json({
        error: 'Price must be a valid non-negative number',
      })
    }

    const addBookQuery = `
      INSERT INTO book (title, author, price, pages)
      VALUES (?, ?, ?, ?);
    `

    const dbResponse = await db.run(addBookQuery, [
      title.trim(),
      author.trim(),
      price,
      pages || 0,
    ])

    response.status(201).json({
      message: 'Book added successfully',
      bookId: dbResponse.lastID,
    })
  } catch (error) {
    console.error(`Error adding book: ${error.message}`)
    response.status(500).json({
      error: 'Failed to add book',
    })
  }
})

// PUT /books/:bookId/ - Update a book
app.put('/books/:bookId/', async (request, response) => {
  try {
    const { bookId } = request.params
    const { title, author, price, pages } = request.body

    if (!title || !author || price === undefined || pages === undefined) {
      return response.status(400).json({
        error: 'Title, author, price, and pages are required',
      })
    }

    if (
      typeof title !== 'string' ||
      typeof author !== 'string' ||
      title.trim() === '' ||
      author.trim() === ''
    ) {
      return response.status(400).json({
        error: 'Title and author must be non-empty strings',
      })
    }

    if (
      typeof price !== 'number' ||
      !Number.isFinite(price) ||
      price < 0 ||
      !Number.isInteger(pages) ||
      pages <= 0
    ) {
      return response.status(400).json({
        error: 'Price must be non-negative and pages must be a positive integer',
      })
    }

    const updateBookQuery = `
      UPDATE book
      SET title = ?, author = ?, price = ?, pages = ?
      WHERE id = ?;
    `

    const dbResponse = await db.run(updateBookQuery, [
      title.trim(),
      author.trim(),
      price,
      pages,
      bookId,
    ])

    if (dbResponse.changes === 0) {
      return response.status(404).json({
        error: 'Book not found',
      })
    }

    response.status(200).json({
      message: 'Book updated successfully',
    })
  } catch (error) {
    console.error(`Error updating book: ${error.message}`)
    response.status(500).json({
      error: 'Failed to update book',
    })
  }
})

// DELETE /books/:bookId/ - Delete a book
app.delete('/books/:bookId/', async (request, response) => {
  try {
    const { bookId } = request.params

    const deleteBookQuery = `
      DELETE FROM book
      WHERE id = ?;
    `

    const dbResponse = await db.run(deleteBookQuery, [bookId])

    if (dbResponse.changes === 0) {
      return response.status(404).json({
        error: 'Book not found',
      })
    }

    response.status(200).json({
      message: 'Book deleted successfully',
    })
  } catch (error) {
    console.error(`Error deleting book: ${error.message}`)
    response.status(500).json({
      error: 'Failed to delete book',
    })
  }
})
module.exports = app;

