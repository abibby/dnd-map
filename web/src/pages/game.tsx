import { FunctionalComponent, h } from 'preact'
import { useState, useCallback, useEffect, useRef } from 'preact/hooks'
import { PinchZoom } from '../components/pinch-zoom'
import styles from './game.module.scss'
import classNames from 'classnames'
import { Token, TokenC, mergeTokens } from '../components/token'
import { getUser } from '../user'
import { connect, Connection } from '../room'
import { v4 as uuidv4 } from 'uuid'
import { openModal, Modal, ModalHeader, ModalBody, ModalControl } from '../components/modal'
import { bindValue, bind } from '@zwzn/spicy'
import { start } from '../engine'

interface GameState {
    background: string;
    updatedAt: number;
    grid: {
        size: number;
        offset: Point;
        visible: boolean;
    };
    tokens: Token[];
}

export function mergeGameState(a: GameState, b: GameState): GameState {
    let newState: GameState

    if (a.updatedAt > b.updatedAt) {
        newState = { ...a }
    } else {
        newState = { ...b }
    }

    const tokenIDs = Array.from(new Set(a.tokens.map(t => t.id).concat(b.tokens.map(t => t.id))))

    return {
        ...newState,
        tokens: tokenIDs.map(id => {
            const ta = a.tokens.find(t => t.id === id)
            const tb = b.tokens.find(t => t.id === id)

            if (ta === undefined) {
                return tb
            }
            if (tb === undefined) {
                return ta
            }
            return mergeTokens(ta, tb)
        }).filter((t): t is Token => t !== undefined),
    }
}

function updateGameState(game: GameState, changes: Partial<GameState>): GameState {
    return {
        ...game,
        ...changes,
        updatedAt: Date.now(),
    }
}

let tokenImages: string[] | undefined
fetch('/img/index.json').then(r => r.json()).then(paths => {
    tokenImages = paths
})

const AddToken: FunctionalComponent<ModalControl<Pick<Token, 'image' | 'size'> | undefined>> = ctx => {
    const [image, setImage] = useState('')
    const [imageSearch, setImageSearch] = useState('')
    const [size, setSize] = useState('1')
    const add = useCallback(() => {
        ctx.resolve({
            image: image,
            size: Number(size),
        })
    }, [size, image, ctx])
    const clickImage = useCallback((img: string) => {
        setImage(img)
    }, [setImage])
    return <Modal onCloseClick={ctx.close}>
        <ModalHeader>Add Token</ModalHeader>
        <ModalBody>
            <label>
                Image:
                <input value={imageSearch} onInput={bindValue(setImageSearch)} />
            </label>
            <ul>
                {tokenImages
                    ?.filter(img => img.toLowerCase().includes(imageSearch.toLowerCase()))
                    .slice(0, 10)
                    .map(img => (
                        <li onClick={bind(img, clickImage)}>
                            <img src={img} style='width: 30px;' />
                            {img}
                        </li>
                    ))}
            </ul>

            <img src={image} style='width: 30px;' />
            <label>
                Size:
                <input type='number' value={size} onInput={bindValue(setSize)} min='1' max='10' />
            </label>
            <button onClick={add}>Add</button>
        </ModalBody>
    </Modal>
}

type Message =
    | { type: 'update'; game: GameState }
    | { type: 'enter' }

interface Props {
    matches: {
        dm: string;
        id: string;
    };
}

export const Game: FunctionalComponent<Props> = props => {
    const [game, setGame] = useState<GameState>({
        background: 'https://i.redd.it/7igkmw001p121.jpg',
        updatedAt: Date.now(),
        grid: {
            size: 50,
            offset: { x: 0, y: 0 },
            visible: true,
        },
        tokens: [
        ],
    })

    const conn = useRef<Connection<Message>>()
    const gameRef = useRef<GameState>(game)

    useEffect(() => {
        connect<Message>(props.matches.dm, props.matches.id).then(c => {
            c.onMessage(msg => {
                console.log('message', msg.type)

                if (msg.type === 'update') {
                    gameRef.current = msg.game
                    setGame(msg.game)
                } else if (msg.type === 'enter') {
                    c.send({ type: 'update', game: gameRef.current })
                }
            })
            c.send({ type: 'enter' })
            conn.current = c
        })

        return () => conn.current?.close()
    }, [props.matches.id, props.matches.dm])

    const changeGame = useCallback((setter: (oldState: GameState) => GameState) => {
        setGame(oldState => {
            const newState = updateGameState(setter(oldState), {})
            gameRef.current = newState
            conn.current?.send({ type: 'update', game: newState })
            return newState
        })
    }, [setGame, conn])

    const addToken = useCallback(async () => {
        const token = await openModal<Pick<Token, 'image' | 'size'> | undefined>(AddToken, undefined)
        if (token === undefined) {
            return
        }

        changeGame(g => ({
            ...g,
            tokens: g.tokens.concat([{
                ...token,
                id: uuidv4(),
                updatedAt: Date.now(),
                position: { x: 1, y: 1 },
                user: getUser(),
                deleted: false,
            }]),
        }))
    }, [changeGame])

    const changeBackground = useCallback(() => {
        const ChangeBackground: FunctionalComponent<ModalControl<never>> = ctx => {
            const [back, setBack] = useState(gameRef.current.background)
            const [size, setSize] = useState(String(gameRef.current.grid.size))
            useEffect(() => {
                changeGame(g => ({
                    ...g,
                    background: back,
                    grid: {
                        ...g.grid,
                        size: Number(size),
                    },
                }))
            }, [back, size])
            return <Modal onCloseClick={ctx.close}>
                <ModalHeader>Change Background</ModalHeader>
                <ModalBody>
                    <div>
                        Background:
                        <input value={back} onInput={bindValue(setBack)} />
                    </div>
                    <div>
                        Size:
                        <input type='number' value={size} onInput={bindValue(setSize)} />
                    </div>
                </ModalBody>
            </Modal>
        }
        openModal(ChangeBackground)
    }, [changeGame])

    const canvasRef = useRef<HTMLCanvasElement | undefined>()

    useEffect(() => {
        if (canvasRef.current) {
            return start(canvasRef.current)
        }
    }, [])

    const isDM = useCallback(() => props.matches.dm === getUser(), [props.matches.dm])
    return <div class={styles.game} >
        <canvas ref={canvasRef} class={styles.map} />
        <div class={styles.hud}>
            <div class={classNames(styles.fab, styles.add)} onClick={addToken}>+</div>
            {isDM() &&
                <div class={classNames(styles.fab, styles.changeBackground)} onClick={changeBackground}>B</div>}
        </div>
    </div>
}
