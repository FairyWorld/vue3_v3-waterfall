import { Ref, h, ref, render, useSlots } from 'vue'
import { isNumber } from '../utils'
import { _v3_error_image } from '../utils/errorImgBase64'
import type { V3WaterfallInnerProperty, WaterfallList, HeightHook } from '../global.d'

type SlotsType = ReturnType<typeof useSlots>

/**
 * @description: 进行分列布局计算
 * @param {string} wrapperID 父元素绑定的id
 * @param {WeakMap} innerWeakMap 元素 -> 内部属性 映射
 * @param {Map} colToListMap 列号 -> 元素列表 映射
 * @param {Ref<number[]>} topOfEveryColumn 每一列下个元素的 top 值
 * @param {number | () => number} bottomGap 底部间隔（计算函数）
 * @param {number} width 元素宽度
 * @param {number} gap 列的间隔
 * @param {string} errorImgSrc 错误图片地址
 * @param {SlotsType} slots slots句柄
 * @param {HeightHook} heightHook 元素高度计算钩子
 * @return {Layout} { wrapperHeight, layout }
 */
export default function useLayout<T extends object>(
  wrapperID: string,
  innerWeakMap: WeakMap<T, V3WaterfallInnerProperty>,
  colToListMap: Map<string | number, WaterfallList<T>>,
  topOfEveryColumn: Ref<number[]>,
  bottomGap: number | (() => number),
  width: Ref<number>,
  gap: Ref<number>,
  errorImgSrc: string,
  slots: SlotsType,
  heightHook: HeightHook<SlotsType, T>
): Layout<T> {
  const wrapperHeight = ref(0)

  const getHeight = heightHook ? heightHook : innerGetHeight

  const getHeightMap = async (list: WaterfallList<T>) => {
    const item2HeightMap = new Map<T, number>()
    await batchGetHeightQueue<T>(list, async (item, cb) => {
      const height = await getHeight(slots, item, width.value, errorImgSrc, wrapperID)
      item2HeightMap.set(item, height)
      cb && cb()
    })
    return item2HeightMap
  }

  const updatePositionAndProperty = (item: T, height: number, topOfEveryColumn: number[], finalBottomGap: number, hashHandler: (item: T) => string) => {
    const indexOfMinTop = topOfEveryColumn.indexOf(Math.min.apply(null, topOfEveryColumn))
    const topOfThisItem = topOfEveryColumn[indexOfMinTop]
    topOfEveryColumn[indexOfMinTop] = topOfThisItem + height + finalBottomGap
    const left = (width.value + gap.value) * indexOfMinTop

    if (!colToListMap.has(indexOfMinTop)) {
      colToListMap.set(indexOfMinTop, [])
    }
    const colList = colToListMap.get(indexOfMinTop)
    colList.push(item)

    // 存储相关内部数据
    const innerObj = {
      _v3_hash: hashHandler(item),
      _v3_styles: {
        width: width.value + 'px',
        left: left + 'px',
        top: topOfThisItem + 'px'
      },
      _v3_height: height,
      _v3_top: topOfThisItem,
      _v3_left: left,
      _v3_position: {
        col: indexOfMinTop, // 第几列，从 0 开始计数
        row: colList.length - 1
      }
    }

    innerWeakMap.set(item, innerObj)
  }

  const layout = async (noLayoutedList: WaterfallList<T>) => {
    if (!noLayoutedList.length) return
    const finalBottomGap = isNumber(bottomGap) ? bottomGap : bottomGap()
    const item2HeightMap = await getHeightMap(noLayoutedList)
    const topOfEveryColumnList = topOfEveryColumn.value

    for (let i = 0; i < noLayoutedList.length; i++) {
      const item = noLayoutedList[i]
      const height = item2HeightMap.get(item)
      const hashHandler = () => hash()
      updatePositionAndProperty(item, height, topOfEveryColumnList, finalBottomGap, hashHandler)
    }
    wrapperHeight.value = Math.max.apply(null, topOfEveryColumnList)
  }


  const insertItemsBefore = async (list: WaterfallList<T>, insertList: WaterfallList<T>) => {
    if (!insertList || !insertList.length) return
    const finalBottomGap = isNumber(bottomGap) ? bottomGap : bottomGap()
    const item2HeightMap = await getHeightMap(insertList)
    // 需要对元素位置进行重新定位
    const newTopOfEveryColumn = new Array(topOfEveryColumn.value.length).fill(0)
    colToListMap.forEach((_, key) => colToListMap.set(key, []))

    const insertLen = insertList.length
    const oldLen = list.length
    const len = insertLen + oldLen
    for (let i = 0; i < len; i++) {
      const item = i < insertLen ? insertList[i] : list[i - insertLen]
      let height = item2HeightMap.get(item) || 0
      if (i >= insertLen) {
        height = innerWeakMap.get(item)._v3_height
      }
      // 如果之前存在的元素，只改变位置信息，hash 不变(渲染时绑定的 key 不变)，减少diff过程
      const hashHandler = (item: T) => {
        const property = innerWeakMap.get(item)
        return property ? property._v3_hash : hash()
      }
      updatePositionAndProperty(item, height, newTopOfEveryColumn, finalBottomGap, hashHandler)
    }
    topOfEveryColumn.value = newTopOfEveryColumn
    wrapperHeight.value = Math.max.apply(null, newTopOfEveryColumn)
  }

  return {
    wrapperHeight,
    layout,
    insertItemsBefore
  }
}

function batchGetHeightQueue<T extends object>(
  list: T[],
  cb: (item: T, next: () => void) => Promise<unknown>
): Promise<void> {
  const MAX_BATCH_COUNT = 5
  let count = 0
  let index = 0
  let completeCount = 0
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return new Promise((resolve, reject) => {
    const next = () => {
      if (count >= MAX_BATCH_COUNT) return
      count++
      const item = list[index]
      if (!item) return
      index++
      cb(item, () => {
        completeCount++
        if (completeCount >= list.length) {
          resolve()
          return
        }
        count--
        next()
      })
      next()
    }
    next()
  })
}

/**
 * 计算元素高度
 * @param {SlotsType} slots 内部 slots 组
 * @param {T} item 该元素块对应数据信息
 * @param {number} width 元素块宽度
 * @param {string} errorImgSrc 用户提供的错误图片
 * @param {string} wrapperID 父元素绑定的id
 * @returns {Promise<number>} 高度
 */
async function innerGetHeight<T>(
  slots: SlotsType,
  item: T,
  width: number,
  errorImgSrc: string,
  wrapperID: string
): Promise<number> {
  const div = document.createElement('div')
  div.style.position = 'absolute'
  div.style.left = '-1000px'
  div.style.width = width + 'px'
  div.style.visibility = 'hidden'

  render(h(slots.default, { item, index: { col: 1, row: 1 } }), div)

  const imgs = div.querySelectorAll('img')
  const replaceObj = await loadImg(imgs, errorImgSrc)
  Object.keys(replaceObj).forEach((k) => {
    item[k] = replaceObj[k]
  })

  const body = document.querySelector(`#${wrapperID}`) || (document.body || document.documentElement)
  body.appendChild(div)
  const height = div.offsetHeight
  body.removeChild(div)
  return height
}

function loadImg(
  imgs: NodeListOf<HTMLImageElement>,
  errImgSrc: string
): Promise<{ [p: string]: string }> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return new Promise((resolve, reject) => {
    const len = imgs.length
    if (len === 0) resolve({})
    const key2Src = {}
    let count = 0
    imgs.forEach((img) => {
      if (!img.src) {
        count++
        if (count === len) resolve(key2Src)
        return
      }
      img.onload = () => {
        count++
        if (count === len) resolve(key2Src)
      }
      img.onerror = () => {
        if (img.getAttribute('data-self')) {
          count++
          if (count === len) resolve(key2Src)
          return
        }
        img.setAttribute('data-self', 'true')
        const src = errImgSrc || _v3_error_image
        const key = img.getAttribute('data-key')
        key2Src[key] = src
        img.src = src
      }
    })
  })
}

function hash(): string {
  return `${Date.now()}-${Math.random()}`
}

type Layout<T> = {
  wrapperHeight: Ref<number>
  layout: (list: T[]) => void
  insertItemsBefore: (list: T[], insertList: T[]) => void
}
