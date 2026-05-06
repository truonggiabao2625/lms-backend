import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'

dotenv.config()

const app = express()
app.use(cors({ origin: process.env.FRONTEND_URL }))
app.use(express.json())

app.get('/health', (req, res) => res.json({ status: 'ok' }))
app.get('/', (req, res) => {
  res.status(200).send('Server is running!');
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Server running on port', process.env.PORT || 3000)
})