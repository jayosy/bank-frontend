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

        stage('Unit tests and coverage') {
            steps {
                timeout(
                    time: 5,
                    unit: 'MINUTES'
                ) {
                    sh '''
                        set -eu

                        echo "=== Tests unitaires et couverture ==="

                        rm -rf \
                        coverage \
                        coverage-publish

                        npm run test:coverage

                        echo
                        echo "=== Fichiers de couverture générés ==="

                        find coverage \
                        -maxdepth 4 \
                        -type f \
                        | sort

                        echo
                        echo "=== Recherche des rapports ==="

                        HTML_INDEX="$(
                            find coverage \
                            -maxdepth 2 \
                            -type f \
                            -name index.html \
                            -print \
                            -quit
                        )"

                        LCOV_FILE="$(
                            find coverage \
                            -maxdepth 3 \
                            -type f \
                            -name lcov.info \
                            -print \
                            -quit
                        )"

                        JSON_SUMMARY="$(
                            find coverage \
                            -maxdepth 3 \
                            -type f \
                            -name coverage-summary.json \
                            -print \
                            -quit
                        )"

                        COBERTURA_FILE="$(
                            find coverage \
                            -maxdepth 3 \
                            -type f \
                            -name '*cobertura*.xml' \
                            -print \
                            -quit
                        )"

                        if [ -z "$HTML_INDEX" ]; then
                            echo "Rapport HTML de couverture introuvable."
                            exit 1
                        fi

                        if [ -z "$LCOV_FILE" ]; then
                            echo "Rapport LCOV introuvable."
                            exit 1
                        fi

                        if [ -z "$JSON_SUMMARY" ]; then
                            echo "Résumé JSON de couverture introuvable."
                            exit 1
                        fi

                        echo "HTML      : $HTML_INDEX"
                        echo "LCOV      : $LCOV_FILE"
                        echo "JSON      : $JSON_SUMMARY"
                        echo "Cobertura : ${COBERTURA_FILE:-non généré}"

                        echo
                        echo "=== Normalisation pour Jenkins ==="

                        REPORT_DIRECTORY="$(dirname "$HTML_INDEX")"

                        mkdir -p coverage-publish

                        cp -R \
                        "$REPORT_DIRECTORY/." \
                        coverage-publish/

                        cp \
                        "$LCOV_FILE" \
                        coverage-publish/lcov.info

                        cp \
                        "$JSON_SUMMARY" \
                        coverage-publish/coverage-summary.json

                        if [ -n "$COBERTURA_FILE" ]; then
                            cp \
                            "$COBERTURA_FILE" \
                            coverage-publish/cobertura-coverage.xml
                        fi

                        test -f coverage-publish/index.html
                        test -f coverage-publish/lcov.info
                        test -f coverage-publish/coverage-summary.json

                        echo
                        echo "Rapports de couverture validés"
                    '''
                }
            }

            post {
                always {
                    archiveArtifacts(
                        artifacts: '''
                            coverage/**/*,
                            coverage-publish/**/*
                        ''',
                        allowEmptyArchive: true,
                        fingerprint: false
                    )

                    publishHTML(
                        target: [
                            reportDir: 'coverage-publish',
                            reportFiles: 'index.html',
                            reportName: 'Couverture Angular',
                            reportTitles: 'Rapport de couverture',
                            keepAll: true,
                            alwaysLinkToLastBuild: true,
                            allowMissing: true
                        ]
                    )
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
