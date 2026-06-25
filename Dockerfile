FROM python:3.12-slim
WORKDIR /app

# Install deps first for layer caching.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App code.
COPY . .

# Drop root: the PDF parser handles hostile, internet-supplied input, so the
# process that does it should not run as uid 0. Create an unprivileged user and
# hand it ownership of the app dir.
RUN useradd --create-home --uid 10001 appuser && chown -R appuser /app
USER appuser

ENV PORT=8000
EXPOSE 8000
CMD ["python", "service.py"]
