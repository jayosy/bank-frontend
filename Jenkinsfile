pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
        skipDefaultCheckout(true)
    }

    tools {
        nodejs 'nodejs-24'
    }

    environment {
        FRONT_INTERNAL_URL = 'http://bank-front:8080'
    }

    stages {
       stage('Checkout') {
            steps {
                script {
                    def scmVariables = checkout scm

                    env.GIT_COMMIT_SHA =
                        scmVariables['GIT_COMMIT'] ?: sh(
                            script: 'git rev-parse HEAD',
                            returnStdout: true
                        ).trim()

                    echo "Commit récupéré : ${env.GIT_COMMIT_SHA}"
                }
            }
        }

        stage('Preflight') {
            steps {
                sh '''
                    set -eu

                    echo "=== Node.js ==="
                    node --version

                    echo
                    echo "=== npm ==="
                    npm --version

                    echo
                    echo "=== Version Node attendue ==="
                    cat .nvmrc

                    ACTIVE_NODE="$(node --version | sed 's/^v//')"
                    EXPECTED_NODE="$(cat .nvmrc)"

                    if [ "$ACTIVE_NODE" != "$EXPECTED_NODE" ]; then
                        echo "Version Node incorrecte."
                        echo "Attendue : $EXPECTED_NODE"
                        echo "Active   : $ACTIVE_NODE"
                        exit 1
                    fi

                    echo
                    echo "=== Docker ==="
                    docker version \
                      --format 'Docker Server: {{.Server.Version}}'

                    echo
                    echo "=== Docker Compose ==="
                    docker compose version

                    echo
                    echo "=== curl ==="
                    command -v curl

                    echo
                    echo "=== Réseau Docker ==="
                    docker network inspect bank-net >/dev/null
                    echo "bank-net disponible"

                    echo
                    echo "=== Configuration Compose ==="
                    docker compose config >/dev/null
                    echo "compose.yaml valide"

                    echo
                    echo "=== Backend depuis Jenkins ==="
                    curl -fsS \
                      http://bank-api:8080/api/health
                '''
            }
        }

        stage('Install dependencies') {
            steps {
                sh '''
                    set -eu

                    npm ci
                '''
            }
        }

        stage('Unit tests') {
            steps {
                timeout(
                    time: 5,
                    unit: 'MINUTES'
                ) {
                    sh '''
                        set -eu

                        echo "=== Tests unitaires Angular ==="

                        npm run test:ci

                        echo
                        echo "Tests unitaires validés"
                    '''
                }
            }
        }

        stage('Build Angular') {
            steps {
                sh '''
                    set -eu

                    npm run build:prod

                    test \
                      -f dist/bank-front/browser/index.html

                    echo "Build Angular validé"
                '''
            }
        }

        stage('Deploy') {
            steps {
                sh '''
                    set -eu

                    docker compose up \
                      -d \
                      --build \
                      bank-front

                    docker compose ps \
                      bank-front
                '''
            }
        }

        stage('Smoke tests') {
            steps {
                sh '''
                    set -eu

                    echo "Attente du démarrage de bank-front..."

                    attempt=1

                    while true
                    do
                        HTTP_CODE="$(
                            curl \
                            -sS \
                            --connect-timeout 3 \
                            --max-time 5 \
                            -o frontend-health.json \
                            -w '%{http_code}' \
                            "$FRONT_INTERNAL_URL/health" ||
                            true
                        )"

                        if [ "$HTTP_CODE" = "200" ]; then
                            break
                        fi

                        if [ "$attempt" -ge 12 ]; then
                            echo "bank-front ne répond pas après 60 secondes."
                            echo "Dernier code HTTP : $HTTP_CODE"

                            cat frontend-health.json 2>/dev/null || true
                            docker compose ps
                            docker compose logs --tail=100 bank-front

                            exit 1
                        fi

                        echo "Tentative $attempt/12 — HTTP $HTTP_CODE"

                        attempt=$((attempt + 1))
                        sleep 5
                    done

                    echo
                    echo "=== Health frontend ==="
                    cat frontend-health.json

                    grep -q '"status":"UP"' frontend-health.json
                    grep -q '"service":"bank-front"' frontend-health.json

                    echo
                    echo "=== Backend via Nginx ==="

                    BACKEND_HTTP_CODE="$(
                        curl \
                        -sS \
                        --connect-timeout 3 \
                        --max-time 10 \
                        -o backend-health.json \
                        -w '%{http_code}' \
                        "$FRONT_INTERNAL_URL/actuator/health" ||
                        true
                    )"

                    if [ "$BACKEND_HTTP_CODE" != "200" ]; then
                        echo "Healthcheck backend en échec."
                        echo "Code HTTP : $BACKEND_HTTP_CODE"

                        cat backend-health.json 2>/dev/null || true
                        exit 1
                    fi

                    cat backend-health.json

                    grep -q '"status":"UP"' backend-health.json

                    echo
                    echo "=== Page Angular ==="

                    curl \
                    -fsS \
                    --connect-timeout 3 \
                    --max-time 10 \
                    "$FRONT_INTERNAL_URL/" |
                    grep -q '<bank-root'

                    echo "Composant bank-root détecté"
                    echo
                    echo "Déploiement frontend validé"
                '''
            }
        }
    }

    post {
        success {
            echo 'Pipeline frontend terminé avec succès.'
        }

        failure {
            echo 'Échec du pipeline frontend.'

            sh '''
                docker compose ps || true

                docker compose logs \
                  --tail=150 \
                  bank-front || true
            '''
        }

        always {
            echo "Build Jenkins : ${env.BUILD_NUMBER}"
            echo "Commit Git    : ${env.GIT_COMMIT_SHA ?: 'inconnu'}"
        }
    }
}
